const OPENROUTER_BASE_URL = process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || 'openai/gpt-4o-mini';

const asTrimmed = (value) => String(value || '').trim();

const CATEGORY_LABELS = {
  academic: 'Academic',
  homework: 'Homework',
  behavior: 'Behavior',
  participation: 'Participation',
  other: 'Other',
  moral: 'Behavior',
  idfk: 'Other',
};

const POSITIVE_PATTERNS = [
  'explained well',
  'helped',
  'volunteered',
  'completed',
  'submitted',
  'improved',
  'positive',
];

const NEGATIVE_PATTERNS = [
  "didn't",
  'did not',
  'struggled',
  'missed',
  'incomplete',
  'distracted',
  'late',
  'absent',
  'flagged',
];

const escapeXml = (value) =>
  String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

const toTone = (value) => {
  const tone = asTrimmed(value).toLowerCase();
  if (tone === 'constructive' || tone === 'supportive' || tone === 'formal') {
    return tone;
  }
  return 'constructive';
};

const callOpenRouter = async ({
  messages,
  model = OPENROUTER_MODEL,
  temperature = 0.35,
  maxTokens = 650,
}) => {
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error('OPENROUTER_API_KEY is missing.');
  }

  const response = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': process.env.OPENROUTER_SITE_URL || 'http://localhost:5000',
      'X-Title': 'Edu Bridge Student Feedback Studio',
    },
    body: JSON.stringify({
      model,
      messages,
      temperature,
      max_tokens: maxTokens,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenRouter request failed: ${text}`);
  }

  const payload = await response.json();
  const content = asTrimmed(payload?.choices?.[0]?.message?.content || '');
  if (!content) {
    throw new Error('No AI response content.');
  }

  return content;
};

const parseJsonPayload = (value) => {
  const text = asTrimmed(value);
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    // Best effort extraction.
  }

  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {
      return null;
    }
  }

  return null;
};

const normalizeSelections = ({ selectedCategories = [], categoryDetails = {} } = {}) => {
  const normalized = [];

  if (Array.isArray(selectedCategories)) {
    selectedCategories.forEach((item) => {
      if (!item) {
        return;
      }

      if (typeof item === 'string') {
        const [rawCategory, ...rest] = item.split(':');
        const category = asTrimmed(rawCategory).toLowerCase();
        const option = asTrimmed(rest.join(':'));
        if (category) {
          normalized.push({
            category,
            option: option || '',
          });
        }
        return;
      }

      const category = asTrimmed(item.category || item.categoryKey || item.key).toLowerCase();
      const option = asTrimmed(item.option || item.optionLabel || item.label || item.value);
      if (category) {
        normalized.push({ category, option });
      }
    });
  }

  if (categoryDetails && typeof categoryDetails === 'object') {
    Object.entries(categoryDetails).forEach(([rawCategory, options]) => {
      const category = asTrimmed(rawCategory).toLowerCase();
      if (!category || !Array.isArray(options)) {
        return;
      }

      options.forEach((rawOption) => {
        const option = asTrimmed(rawOption);
        if (option) {
          normalized.push({ category, option });
        }
      });
    });
  }

  const seen = new Set();
  return normalized
    .map((entry) => ({
      category: asTrimmed(entry.category).toLowerCase(),
      option: asTrimmed(entry.option),
    }))
    .filter((entry) => entry.category)
    .filter((entry) => {
      const key = `${entry.category}::${entry.option.toLowerCase()}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
};

const toDetailsMap = (selectedItems = []) =>
  selectedItems.reduce((acc, item) => {
    const key = item.category;
    if (!acc[key]) {
      acc[key] = [];
    }

    if (item.option) {
      acc[key].push(item.option);
    }
    return acc;
  }, {});

const toCategoryList = (selectedItems = []) => [
  ...new Set(
    selectedItems
      .map((item) => asTrimmed(item.category).toLowerCase())
      .filter(Boolean)
  ),
];

const labelCategory = (value) => CATEGORY_LABELS[asTrimmed(value).toLowerCase()] || value || 'General';

const splitStrengthsConcerns = (selectedItems = []) => {
  const strengths = [];
  const concerns = [];

  selectedItems.forEach((item) => {
    const option = asTrimmed(item.option);
    if (!option) {
      return;
    }

    const lowered = option.toLowerCase();
    const isPositive = POSITIVE_PATTERNS.some((pattern) => lowered.includes(pattern));
    const isNegative = NEGATIVE_PATTERNS.some((pattern) => lowered.includes(pattern));

    const labeled = `${labelCategory(item.category)}: ${option}`;
    if (isPositive && !isNegative) {
      strengths.push(labeled);
      return;
    }

    concerns.push(labeled);
  });

  return {
    strengths: strengths.slice(0, 4),
    concerns: concerns.slice(0, 6),
  };
};

const buildTrendAnalysis = ({ signals = {}, recentFeedback = [], selectedItems = [] } = {}) => {
  const recent = Array.isArray(recentFeedback) ? recentFeedback : [];
  const selectedCategories = toCategoryList(selectedItems);
  const repeatedIssues = [];

  selectedCategories.forEach((category) => {
    const count = recent.filter((item) => asTrimmed(item.category).toLowerCase() === category).length;
    if (count >= 2) {
      repeatedIssues.push(`${labelCategory(category)} has appeared ${count} times recently.`);
    }
  });

  const pendingHomework = Number(signals?.pendingHomeworkCount || 0);
  const attendance = Number(signals?.attendance?.attendancePercentage || 0);
  const riskStatus = asTrimmed(signals?.riskStatus || 'Low');
  const flags = [];

  if (pendingHomework >= 2) {
    flags.push(`Pending homework tasks: ${pendingHomework}`);
  }
  if (attendance > 0 && attendance < 85) {
    flags.push(`Attendance is below target (${attendance}%).`);
  }
  if (riskStatus === 'High') {
    flags.push('Student risk profile is currently high.');
  } else if (riskStatus === 'Medium') {
    flags.push('Student risk profile is currently medium.');
  }
  repeatedIssues.forEach((item) => flags.push(item));

  const urgency =
    riskStatus === 'High' || pendingHomework >= 3 || flags.length >= 4
      ? 'high'
      : riskStatus === 'Medium' || pendingHomework >= 2 || flags.length >= 2
        ? 'medium'
        : 'low';

  return {
    urgency,
    flags,
    repeatedIssues,
    pendingHomework,
    riskStatus,
    attendancePattern: asTrimmed(signals?.attendancePattern || ''),
    behaviorNote: asTrimmed(signals?.behaviorNote || ''),
    academicDirection: asTrimmed(signals?.academicDirection || 'Stable'),
  };
};

const createVisualSummary = ({ studentName, selectedItems = [], trendAnalysis = {}, summary = {} } = {}) => {
  const categories = toCategoryList(selectedItems);
  const metrics = [
    { label: 'Selections', value: String(selectedItems.length) },
    { label: 'Repeated', value: String((trendAnalysis.repeatedIssues || []).length) },
    { label: 'Pending HW', value: String(trendAnalysis.pendingHomework || 0) },
    { label: 'Urgency', value: String(trendAnalysis.urgency || 'low').toUpperCase() },
  ];

  const highlights = [
    ...(summary?.concerns || []).slice(0, 2),
    ...(trendAnalysis?.flags || []).slice(0, 2),
  ].slice(0, 3);

  const chips = categories.map((item) => labelCategory(item)).slice(0, 4);
  const title = `${asTrimmed(studentName) || 'Student'} Feedback Snapshot`;

  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="580" viewBox="0 0 1080 580">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#f5f7fb"/>
      <stop offset="100%" stop-color="#eef3f9"/>
    </linearGradient>
  </defs>
  <rect width="1080" height="580" rx="24" fill="url(#bg)"/>
  <rect x="34" y="34" width="1012" height="512" rx="18" fill="#ffffff" stroke="#dbe4ee"/>
  <text x="66" y="94" font-size="34" font-family="Segoe UI, Arial, sans-serif" fill="#102b46">${escapeXml(title)}</text>
  <text x="66" y="128" font-size="20" font-family="Segoe UI, Arial, sans-serif" fill="#4c5f73">AI Structured Communication Card</text>

  <rect x="66" y="162" width="948" height="114" rx="12" fill="#f7fafd" stroke="#dbe4ee"/>
  ${metrics
    .map(
      (metric, index) => `
  <text x="${88 + index * 228}" y="205" font-size="18" font-family="Segoe UI, Arial, sans-serif" fill="#597084">${escapeXml(metric.label)}</text>
  <text x="${88 + index * 228}" y="248" font-size="36" font-weight="700" font-family="Segoe UI, Arial, sans-serif" fill="#143d66">${escapeXml(metric.value)}</text>`
    )
    .join('')}

  ${chips
    .map(
      (chip, index) => `
  <rect x="${66 + index * 236}" y="300" width="216" height="44" rx="22" fill="#edf4fb" stroke="#cddded"/>
  <text x="${86 + index * 236}" y="328" font-size="17" font-family="Segoe UI, Arial, sans-serif" fill="#234b70">${escapeXml(chip)}</text>`
    )
    .join('')}

  <text x="66" y="388" font-size="22" font-family="Segoe UI, Arial, sans-serif" fill="#143d66">Priority Notes</text>
  ${highlights
    .map(
      (line, index) => `
  <circle cx="78" cy="${424 + index * 42}" r="5" fill="#3a7ab4"/>
  <text x="96" y="${430 + index * 42}" font-size="20" font-family="Segoe UI, Arial, sans-serif" fill="#354d63">${escapeXml(line)}</text>`
    )
    .join('')}
</svg>`.trim();

  return {
    title,
    metrics,
    highlights,
    imageDataUrl: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
  };
};

const fallbackMessage = ({
  studentName = '',
  recipientRole = 'teacher',
  subject = '',
  summary = {},
  notes = '',
  trendAnalysis = {},
}) => {
  const lead =
    recipientRole === 'parent'
      ? `Dear Parent, this is a structured update regarding ${studentName || 'the student'}`
      : `Dear Teacher, this is a structured student note regarding ${studentName || 'the student'}`;
  const subjectLine = subject ? ` in ${subject}` : '';
  const concerns = (summary?.concerns || []).slice(0, 3).join('; ');
  const strengths = (summary?.strengths || []).slice(0, 2).join('; ');
  const flags = (trendAnalysis?.flags || []).slice(0, 2).join('; ');

  const parts = [
    `${lead}${subjectLine}.`,
    concerns ? `Main observations: ${concerns}.` : '',
    strengths ? `Positive indicators: ${strengths}.` : '',
    flags ? `AI trend notes: ${flags}.` : '',
    notes ? `Additional student note: ${notes}.` : '',
    'Recommended next step: align on one clear action for the upcoming week.',
  ].filter(Boolean);

  return parts.join(' ');
};

const buildDraftWithAI = async ({
  studentName,
  recipientRole,
  subject,
  selectedItems,
  notes,
  tone,
  trendAnalysis,
  summary,
}) => {
  const promptSelections = selectedItems
    .map((item) => `${labelCategory(item.category)} -> ${item.option || 'General observation'}`)
    .join('\n');

  const raw = await callOpenRouter({
    temperature: 0.28,
    maxTokens: 700,
    messages: [
      {
        role: 'system',
        content:
          'You write concise school communication messages. Return JSON with keys message and actionItems (array of max 3).',
      },
      {
        role: 'user',
        content: [
          `Recipient role: ${recipientRole}`,
          `Tone: ${tone}`,
          `Student: ${studentName}`,
          `Subject: ${subject || 'General'}`,
          'Selected observations:',
          promptSelections || 'No explicit observations.',
          `Concerns: ${(summary?.concerns || []).join('; ') || 'None'}`,
          `Strengths: ${(summary?.strengths || []).join('; ') || 'None'}`,
          `Trend flags: ${(trendAnalysis?.flags || []).join('; ') || 'None'}`,
          `Student note: ${notes || 'None'}`,
          'Rules: Parent-friendly, factual, calm, and actionable. Do not use punitive language.',
        ].join('\n'),
      },
    ],
  });

  const parsed = parseJsonPayload(raw);
  const message = asTrimmed(parsed?.message);
  const actionItems = Array.isArray(parsed?.actionItems)
    ? parsed.actionItems.map((item) => asTrimmed(item)).filter(Boolean).slice(0, 3)
    : [];

  if (!message) {
    throw new Error('AI draft is missing message.');
  }

  return {
    message,
    actionItems,
    engine: 'openrouter',
  };
};

const generateStudentFeedbackDraft = async ({
  studentName = '',
  recipientRole = 'teacher',
  subject = '',
  selectedCategories = [],
  categoryDetails = {},
  notes = '',
  tone = 'constructive',
  recentFeedback = [],
  signals = {},
}) => {
  const selectedItems = normalizeSelections({ selectedCategories, categoryDetails });
  if (!selectedItems.length) {
    return {
      message: '',
      selectedItems: [],
      categories: [],
      categoryDetails: {},
      summary: { strengths: [], concerns: [], actionItems: [] },
      trendAnalysis: buildTrendAnalysis({ signals, recentFeedback, selectedItems: [] }),
      visualSummary: createVisualSummary({
        studentName,
        selectedItems: [],
        trendAnalysis: { urgency: 'low', repeatedIssues: [], pendingHomework: 0, flags: [] },
        summary: { concerns: [] },
      }),
      engine: 'rule-based',
    };
  }

  const summary = splitStrengthsConcerns(selectedItems);
  const trendAnalysis = buildTrendAnalysis({ signals, recentFeedback, selectedItems });
  const normalizedTone = toTone(tone);

  let draft = null;
  if (process.env.OPENROUTER_API_KEY) {
    try {
      draft = await buildDraftWithAI({
        studentName,
        recipientRole,
        subject,
        selectedItems,
        notes,
        tone: normalizedTone,
        trendAnalysis,
        summary,
      });
    } catch {
      draft = null;
    }
  }

  const message =
    draft?.message ||
    fallbackMessage({
      studentName,
      recipientRole,
      subject,
      summary,
      notes,
      trendAnalysis,
    });

  const actionItems =
    draft?.actionItems && draft.actionItems.length
      ? draft.actionItems
      : [
          'Review one priority concern in the next session.',
          'Track completion of pending tasks this week.',
          'Follow up with a brief progress update.',
        ];

  const visualSummary = createVisualSummary({
    studentName,
    selectedItems,
    trendAnalysis,
    summary,
  });

  return {
    message,
    selectedItems,
    categories: toCategoryList(selectedItems),
    categoryDetails: toDetailsMap(selectedItems),
    summary: {
      strengths: summary.strengths,
      concerns: summary.concerns,
      actionItems: actionItems.slice(0, 3),
    },
    trendAnalysis,
    visualSummary,
    engine: draft?.engine || 'rule-based',
  };
};

const fallbackRewrite = ({ text, tone }) => {
  const normalizedTone = toTone(tone);
  if (normalizedTone === 'supportive') {
    return `Thank you for your effort. ${asTrimmed(text)} We appreciate your continued improvement and commitment.`;
  }
  if (normalizedTone === 'formal') {
    return `Structured update: ${asTrimmed(text)}`;
  }
  return asTrimmed(text);
};

const rewriteFeedbackMessage = async ({ text = '', tone = 'constructive' }) => {
  const source = asTrimmed(text);
  if (!source) {
    return {
      rewrittenText: '',
      tone: toTone(tone),
      engine: 'rule-based',
    };
  }

  const normalizedTone = toTone(tone);

  if (!process.env.OPENROUTER_API_KEY) {
    return {
      rewrittenText: fallbackRewrite({ text: source, tone: normalizedTone }),
      tone: normalizedTone,
      engine: 'rule-based',
    };
  }

  try {
    const raw = await callOpenRouter({
      temperature: 0.25,
      maxTokens: 450,
      messages: [
        {
          role: 'system',
          content:
            'Rewrite school communication text with the requested tone. Return JSON with key rewrittenText.',
        },
        {
          role: 'user',
          content: [
            `Tone: ${normalizedTone}`,
            'Constraints: keep meaning unchanged, clear and parent-friendly, max 170 words.',
            `Text: ${source}`,
          ].join('\n'),
        },
      ],
    });

    const parsed = parseJsonPayload(raw);
    const rewrittenText = asTrimmed(parsed?.rewrittenText);
    if (!rewrittenText) {
      throw new Error('Missing rewritten text.');
    }

    return {
      rewrittenText,
      tone: normalizedTone,
      engine: 'openrouter',
    };
  } catch {
    return {
      rewrittenText: fallbackRewrite({ text: source, tone: normalizedTone }),
      tone: normalizedTone,
      engine: 'rule-based',
    };
  }
};

module.exports = {
  normalizeSelections,
  generateStudentFeedbackDraft,
  rewriteFeedbackMessage,
};

