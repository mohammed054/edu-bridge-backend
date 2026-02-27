const OPENROUTER_BASE_URL = process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || 'openai/gpt-4o-mini';
const OPENROUTER_VISION_MODEL = process.env.OPENROUTER_VISION_MODEL || OPENROUTER_MODEL;

const ARABIC_DIGIT_MAP = {
  '\u0660': '0',
  '\u0661': '1',
  '\u0662': '2',
  '\u0663': '3',
  '\u0664': '4',
  '\u0665': '5',
  '\u0666': '6',
  '\u0667': '7',
  '\u0668': '8',
  '\u0669': '9',
  '\u06F0': '0',
  '\u06F1': '1',
  '\u06F2': '2',
  '\u06F3': '3',
  '\u06F4': '4',
  '\u06F5': '5',
  '\u06F6': '6',
  '\u06F7': '7',
  '\u06F8': '8',
  '\u06F9': '9',
};

const normalizeDigits = (value) =>
  String(value || '')
    .split('')
    .map((char) => ARABIC_DIGIT_MAP[char] || char)
    .join('');

const asTrimmed = (value) => String(value || '').trim();

const round = (value, digits = 2) => Number(Number(value || 0).toFixed(digits));

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const normalizeWhitespace = (value) => asTrimmed(value).replace(/\s+/g, ' ');

const normalizeName = (value) =>
  normalizeWhitespace(value)
    .toLowerCase()
    .replace(/[\u0610-\u061A\u064B-\u065F\u06D6-\u06ED]/g, '')
    .replace(/[^\u0600-\u06FFa-z0-9\s]/gi, '')
    .replace(/\s+/g, ' ');

const tokenizeName = (value) => normalizeName(value).split(' ').filter(Boolean);

const jaccardSimilarity = (leftValue, rightValue) => {
  const leftTokens = tokenizeName(leftValue);
  const rightTokens = tokenizeName(rightValue);

  if (!leftTokens.length || !rightTokens.length) {
    return 0;
  }

  const leftSet = new Set(leftTokens);
  const rightSet = new Set(rightTokens);
  let intersection = 0;

  leftSet.forEach((token) => {
    if (rightSet.has(token)) {
      intersection += 1;
    }
  });

  const union = new Set([...leftSet, ...rightSet]).size;
  return union ? intersection / union : 0;
};

const parseNumber = (value) => {
  const normalized = normalizeDigits(value);
  const candidate = normalized.replace(/,/g, '.').match(/-?\d+(?:\.\d+)?/);
  if (!candidate) {
    return null;
  }

  const parsed = Number(candidate[0]);
  return Number.isNaN(parsed) ? null : parsed;
};

const parseScoreFromValue = (value, fallbackMaxMarks = 100) => {
  const text = normalizeDigits(String(value || ''));
  const issues = [];

  if (!asTrimmed(text)) {
    return {
      score: null,
      maxMarks: Number(fallbackMaxMarks || 100),
      issues: ['missing_score'],
    };
  }

  const ratioMatch = text.match(/(-?\d+(?:\.\d+)?)\s*\/\s*(-?\d+(?:\.\d+)?)/);
  if (ratioMatch) {
    const score = Number(ratioMatch[1]);
    const maxMarks = Number(ratioMatch[2]);

    if (Number.isNaN(score) || Number.isNaN(maxMarks)) {
      issues.push('invalid_numeric_value');
      return {
        score: null,
        maxMarks: Number(fallbackMaxMarks || 100),
        issues,
      };
    }

    return {
      score,
      maxMarks,
      issues,
    };
  }

  const percentMatch = text.match(/(-?\d+(?:\.\d+)?)\s*%/);
  if (percentMatch) {
    const percent = Number(percentMatch[1]);
    if (Number.isNaN(percent)) {
      issues.push('invalid_numeric_value');
      return {
        score: null,
        maxMarks: 100,
        issues,
      };
    }

    return {
      score: percent,
      maxMarks: 100,
      issues,
    };
  }

  const score = parseNumber(text);
  if (score === null) {
    issues.push('missing_score');
  }

  return {
    score,
    maxMarks: Number(fallbackMaxMarks || 100),
    issues,
  };
};

const extractJsonPayload = (value) => {
  const text = asTrimmed(value);
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    // Continue with best-effort extraction.
  }

  const arrayStart = text.indexOf('[');
  const arrayEnd = text.lastIndexOf(']');
  if (arrayStart >= 0 && arrayEnd > arrayStart) {
    const candidate = text.slice(arrayStart, arrayEnd + 1);
    try {
      return JSON.parse(candidate);
    } catch {
      // Continue.
    }
  }

  const objectStart = text.indexOf('{');
  const objectEnd = text.lastIndexOf('}');
  if (objectStart >= 0 && objectEnd > objectStart) {
    const candidate = text.slice(objectStart, objectEnd + 1);
    try {
      return JSON.parse(candidate);
    } catch {
      return null;
    }
  }

  return null;
};

const callOpenRouter = async ({ messages, model = OPENROUTER_MODEL, temperature = 0.2, maxTokens = 900 }) => {
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error('OPENROUTER_API_KEY is missing.');
  }

  const response = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': process.env.OPENROUTER_SITE_URL || 'http://localhost:5000',
      'X-Title': 'Edu Bridge AI Academic Intelligence',
    },
    body: JSON.stringify({
      model,
      messages,
      temperature,
      max_tokens: maxTokens,
    }),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`OpenRouter request failed: ${message}`);
  }

  const payload = await response.json();
  return asTrimmed(payload?.choices?.[0]?.message?.content || '');
};

const parseRowsFromPlainText = ({ ocrText = '', defaultMaxMarks = 100 }) => {
  const lines = String(ocrText || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const rows = [];

  lines.forEach((line) => {
    const normalizedLine = normalizeDigits(line);

    const fractionMatch = normalizedLine.match(/^(.*?)\s+(-?\d+(?:\.\d+)?)\s*\/\s*(-?\d+(?:\.\d+)?)\s*$/);
    if (fractionMatch) {
      rows.push({
        sourceStudentName: normalizeWhitespace(fractionMatch[1]),
        score: Number(fractionMatch[2]),
        maxMarks: Number(fractionMatch[3]),
      });
      return;
    }

    const parts = normalizedLine.split(/\t|\||,|;|\s{2,}/).map((part) => part.trim()).filter(Boolean);
    if (parts.length < 2) {
      return;
    }

    const possibleScore = parseScoreFromValue(parts[parts.length - 1], defaultMaxMarks);
    if (possibleScore.score === null) {
      return;
    }

    rows.push({
      sourceStudentName: normalizeWhitespace(parts.slice(0, -1).join(' ')),
      score: possibleScore.score,
      maxMarks: possibleScore.maxMarks,
    });
  });

  return {
    columns: ['Student Name', 'Score'],
    rows,
    notes: rows.length
      ? []
      : ['No structured rows were found in OCR text. You can manually add rows before confirming import.'],
  };
};

const runAiGradeExtraction = async ({ fileDataUrl = '', ocrText = '', defaultMaxMarks = 100 }) => {
  const hasText = Boolean(asTrimmed(ocrText));
  const hasImage = /^data:image\//i.test(asTrimmed(fileDataUrl));

  if (!hasText && !hasImage) {
    return null;
  }

  if (!process.env.OPENROUTER_API_KEY) {
    return null;
  }

  const userContent = [
    {
      type: 'text',
      text: [
        'Extract grade sheet rows from the provided data.',
        'Return only JSON in this exact format:',
        '{"columns": ["name", "score", "max"], "rows": [{"studentName": "", "score": 0, "maxMarks": 100}], "notes": []}',
        'Rules:',
        '- Detect Arabic and English column names.',
        '- Preserve student names exactly as shown.',
        '- Score fields must be numeric when possible.',
        '- If value looks like 17/20, return score=17 and maxMarks=20.',
        `- Use ${Number(defaultMaxMarks || 100)} as default maxMarks when missing.`,
        '- Ignore non-grade rows and headers.',
      ].join('\n'),
    },
  ];

  if (hasText) {
    userContent.push({
      type: 'text',
      text: `OCR text:\n${String(ocrText).slice(0, 9000)}`,
    });
  }

  if (hasImage) {
    userContent.push({
      type: 'image_url',
      image_url: {
        url: fileDataUrl,
      },
    });
  }

  try {
    const output = await callOpenRouter({
      model: hasImage ? OPENROUTER_VISION_MODEL : OPENROUTER_MODEL,
      temperature: 0,
      maxTokens: 1200,
      messages: [
        {
          role: 'system',
          content:
            'You are a precise OCR extraction assistant for school grade sheets. Return only valid JSON.',
        },
        {
          role: 'user',
          content: userContent,
        },
      ],
    });

    const parsed = extractJsonPayload(output);
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }

    const rows = Array.isArray(parsed.rows)
      ? parsed.rows.map((row) => ({
          sourceStudentName: normalizeWhitespace(row.studentName || row.name || row.student || ''),
          score: parseNumber(row.score),
          maxMarks: parseNumber(row.maxMarks || row.max || defaultMaxMarks),
        }))
      : [];

    return {
      columns: Array.isArray(parsed.columns) ? parsed.columns.map((item) => asTrimmed(item)).filter(Boolean) : [],
      rows,
      notes: Array.isArray(parsed.notes) ? parsed.notes.map((item) => asTrimmed(item)).filter(Boolean) : [],
    };
  } catch {
    return null;
  }
};

const buildStudentDirectory = (students = []) => {
  const directory = {
    byId: {},
    byNormalizedName: {},
    list: [],
  };

  students.forEach((student) => {
    const studentId = String(student._id || student.id || '');
    const studentName = normalizeWhitespace(student.name || '');
    const normalized = normalizeName(studentName);

    if (!studentId || !studentName) {
      return;
    }

    const entry = {
      studentId,
      studentName,
      normalizedName: normalized,
      className: (student.classes || [])[0] || '',
      examMarks: student.examMarks || [],
    };

    directory.byId[studentId] = entry;
    directory.list.push(entry);

    if (!directory.byNormalizedName[normalized]) {
      directory.byNormalizedName[normalized] = [];
    }
    directory.byNormalizedName[normalized].push(entry);
  });

  return directory;
};

const buildMatchingCandidates = (sourceName, directory, limit = 3) => {
  const normalized = normalizeName(sourceName);
  if (!normalized) {
    return [];
  }

  const exact = directory.byNormalizedName[normalized] || [];
  if (exact.length) {
    return exact.slice(0, limit).map((item) => ({
      studentId: item.studentId,
      studentName: item.studentName,
      confidence: 1,
    }));
  }

  return directory.list
    .map((entry) => ({
      studentId: entry.studentId,
      studentName: entry.studentName,
      confidence: jaccardSimilarity(normalized, entry.normalizedName),
    }))
    .filter((item) => item.confidence > 0)
    .sort((left, right) => right.confidence - left.confidence)
    .slice(0, limit);
};

const resolveBestMatch = (sourceName, directory) => {
  const candidates = buildMatchingCandidates(sourceName, directory, 3);
  if (!candidates.length) {
    return {
      matchedStudentId: '',
      matchedStudentName: '',
      confidence: 0,
      candidates,
    };
  }

  const top = candidates[0];
  const threshold = top.confidence >= 0.62 ? top : null;

  if (!threshold) {
    return {
      matchedStudentId: '',
      matchedStudentName: '',
      confidence: top.confidence,
      candidates,
    };
  }

  return {
    matchedStudentId: threshold.studentId,
    matchedStudentName: threshold.studentName,
    confidence: threshold.confidence,
    candidates,
  };
};

const buildOverwriteCheck = ({ studentEntry, subject, examTitle, score, maxMarks }) => {
  const marks = studentEntry?.examMarks || [];
  const index = marks.findIndex(
    (item) =>
      asTrimmed(item.subject).toLowerCase() === asTrimmed(subject).toLowerCase() &&
      asTrimmed(item.examTitle || 'Assessment').toLowerCase() ===
        asTrimmed(examTitle || 'Assessment').toLowerCase()
  );

  if (index < 0) {
    return {
      hasExisting: false,
      requiresOverwriteConfirmation: false,
      existing: null,
    };
  }

  const existing = marks[index] || {};
  const existingScore = existing.rawScore === null || existing.rawScore === undefined
    ? Number(existing.score || 0)
    : Number(existing.rawScore);
  const existingMaxMarks = Number(existing.maxMarks || 100) || 100;

  const hasDifference =
    round(existingScore, 4) !== round(Number(score || 0), 4) ||
    round(existingMaxMarks, 4) !== round(Number(maxMarks || 0), 4);

  return {
    hasExisting: true,
    requiresOverwriteConfirmation: hasDifference,
    existing: {
      score: existingScore,
      maxMarks: existingMaxMarks,
      updatedAt: existing.updatedAt || null,
      examTitle: existing.examTitle || 'Assessment',
    },
  };
};

const normalizeInputRows = (rows = [], defaultMaxMarks = 100) =>
  rows.map((row) => {
    const sourceStudentName = normalizeWhitespace(
      row.sourceStudentName || row.studentName || row.name || row.student || ''
    );

    const parsed =
      row.score !== undefined
        ? {
            score: parseNumber(row.score),
            maxMarks: parseNumber(row.maxMarks || defaultMaxMarks),
            issues: [],
          }
        : parseScoreFromValue(row.scoreText || row.value || row.grade || '', defaultMaxMarks);

    return {
      sourceStudentName,
      score: parsed.score,
      maxMarks: parsed.maxMarks,
      issues: parsed.issues || [],
      examTitle: normalizeWhitespace(row.examTitle || ''),
      matchedStudentId: asTrimmed(row.matchedStudentId || ''),
      confirmOverwrite: row.confirmOverwrite === true,
      skip: row.skip === true,
    };
  });

const buildGradeSheetPreview = async ({
  students = [],
  subject = '',
  examTitle = 'Assessment',
  defaultMaxMarks = 100,
  fileDataUrl = '',
  ocrText = '',
  rows = [],
}) => {
  const directory = buildStudentDirectory(students);

  const normalizedRowsInput = normalizeInputRows(rows, defaultMaxMarks);

  let extraction = null;
  if (!normalizedRowsInput.length) {
    extraction = await runAiGradeExtraction({ fileDataUrl, ocrText, defaultMaxMarks });
    if (!extraction || !Array.isArray(extraction.rows) || !extraction.rows.length) {
      extraction = parseRowsFromPlainText({ ocrText, defaultMaxMarks });
    }
  }

  const extractedRows = normalizedRowsInput.length
    ? normalizedRowsInput
    : normalizeInputRows(extraction?.rows || [], defaultMaxMarks);

  const previewRows = extractedRows.map((row, index) => {
    const issues = [...new Set(row.issues || [])];

    const safeMaxMarks = Number(row.maxMarks || defaultMaxMarks);
    const safeScore = row.score === null ? null : Number(row.score);

    if (!row.sourceStudentName) {
      issues.push('missing_student_name');
    }

    if (safeScore === null || Number.isNaN(safeScore)) {
      issues.push('missing_score');
    }

    if (Number.isNaN(safeMaxMarks) || safeMaxMarks <= 0) {
      issues.push('invalid_max_marks');
    }

    if (safeScore !== null && !Number.isNaN(safeScore) && !Number.isNaN(safeMaxMarks) && safeMaxMarks > 0) {
      if (safeScore < 0 || safeScore > safeMaxMarks) {
        issues.push('score_out_of_range');
      }
    }

    const preMatched = asTrimmed(row.matchedStudentId || '');
    const bestMatch = preMatched
      ? {
          matchedStudentId: preMatched,
          matchedStudentName: directory.byId[preMatched]?.studentName || '',
          confidence: directory.byId[preMatched] ? 1 : 0,
          candidates: buildMatchingCandidates(row.sourceStudentName, directory),
        }
      : resolveBestMatch(row.sourceStudentName, directory);

    const studentEntry = bestMatch.matchedStudentId ? directory.byId[bestMatch.matchedStudentId] : null;
    if (!studentEntry) {
      issues.push('unrecognized_name');
    }

    const resolvedExamTitle = row.examTitle || asTrimmed(examTitle) || 'Assessment';

    const overwrite = buildOverwriteCheck({
      studentEntry,
      subject,
      examTitle: resolvedExamTitle,
      score: safeScore,
      maxMarks: safeMaxMarks,
    });

    if (overwrite.requiresOverwriteConfirmation) {
      issues.push('overwrite_confirmation_required');
    }

    const normalizedPercentage =
      safeScore === null || Number.isNaN(safeScore) || Number.isNaN(safeMaxMarks) || safeMaxMarks <= 0
        ? null
        : round(clamp((safeScore / safeMaxMarks) * 100, 0, 100));

    return {
      rowIndex: index,
      sourceStudentName: row.sourceStudentName,
      matchedStudentId: bestMatch.matchedStudentId,
      matchedStudentName: bestMatch.matchedStudentName,
      matchConfidence: round(bestMatch.confidence, 3),
      candidateMatches: bestMatch.candidates,
      score: safeScore,
      maxMarks: Number.isNaN(safeMaxMarks) ? null : safeMaxMarks,
      normalizedPercentage,
      examTitle: resolvedExamTitle,
      issues,
      skip: row.skip === true,
      confirmOverwrite: row.confirmOverwrite === true,
      overwrite,
    };
  });

  const recognizedRows = previewRows.filter((row) => row.matchedStudentId && !row.skip);
  const unrecognizedRows = previewRows.filter((row) => !row.matchedStudentId && !row.skip);
  const inconsistentRows = previewRows.filter((row) =>
    row.issues.some((issue) =>
      [
        'missing_score',
        'invalid_max_marks',
        'score_out_of_range',
        'overwrite_confirmation_required',
        'missing_student_name',
      ].includes(issue)
    )
  );

  return {
    detectedColumns: extraction?.columns?.length ? extraction.columns : ['Student Name', 'Score', 'Max Marks'],
    detectedRows: previewRows,
    unrecognizedNames: unrecognizedRows.map((row) => row.sourceStudentName || `Row ${row.rowIndex + 1}`),
    inconsistentRows: inconsistentRows.map((row) => ({
      rowIndex: row.rowIndex,
      sourceStudentName: row.sourceStudentName,
      issues: row.issues,
    })),
    summary: {
      totalRows: previewRows.length,
      matchedRows: recognizedRows.length,
      unrecognizedRows: unrecognizedRows.length,
      inconsistentRows: inconsistentRows.length,
      overwriteRows: previewRows.filter((row) => row.overwrite.requiresOverwriteConfirmation).length,
    },
    notes: extraction?.notes || [],
  };
};

const toneLabel = (tone) => {
  const normalized = asTrimmed(tone).toLowerCase();
  if (normalized === 'firm') {
    return 'firm';
  }
  if (normalized === 'encouraging') {
    return 'encouraging';
  }
  return 'neutral';
};

const buildParentVoice = (tone) => {
  if (tone === 'firm') {
    return 'Use concise language with clear expectations while staying respectful and calm.';
  }

  if (tone === 'encouraging') {
    return 'Use supportive and motivating wording, highlight growth opportunities, and keep a calm tone.';
  }

  return 'Use balanced and calm wording focused on facts and actionable next steps.';
};

const buildSignalsText = (signals = {}) => {
  const grades = signals.grades || {};
  const attendance = signals.attendance || {};
  const incidents = signals.incidents || {};

  return [
    `Academic direction: ${signals.academicDirection || 'Stable'}`,
    `Latest grade %: ${grades.latestPercentage ?? 'N/A'}`,
    `Previous grade %: ${grades.previousPercentage ?? 'N/A'}`,
    `Grade delta %: ${grades.deltaPercentage ?? 'N/A'}`,
    `Attendance %: ${attendance.attendancePercentage ?? 'N/A'}`,
    `Attendance present/absent/late: ${attendance.present ?? 0}/${attendance.absent ?? 0}/${attendance.late ?? 0}`,
    `Behavior incidents low/medium/high: ${incidents.low ?? 0}/${incidents.medium ?? 0}/${incidents.high ?? 0}`,
    `Parent engagement status: ${signals.parentEngagementStatus || 'Medium'}`,
    `Risk status: ${signals.riskStatus || 'Low'}`,
    `Trend shifts: ${(signals.trendShifts || []).join('; ') || 'None'}`,
  ].join('\n');
};

const fallbackFeedbackDraft = ({ studentName, subject, tone, signals }) => {
  const grades = signals.grades || {};
  const attendance = signals.attendance || {};
  const incidents = signals.incidents || {};

  const toneLead =
    tone === 'firm'
      ? 'Progress requires immediate consistency in daily study habits.'
      : tone === 'encouraging'
        ? 'There is room to build momentum with steady routines.'
        : 'Current performance indicates mixed consistency.';

  const teacherInternalSummary = [
    `${studentName} - ${subject}: ${signals.academicDirection || 'Stable'} academic direction.`,
    `Latest evidence: ${grades.latestPercentage ?? 'N/A'}% (previous ${grades.previousPercentage ?? 'N/A'}%, delta ${grades.deltaPercentage ?? 'N/A'}%).`,
    `Attendance: ${attendance.attendancePercentage ?? 'N/A'}% with ${attendance.absent ?? 0} absences and ${attendance.late ?? 0} late arrivals.`,
    `Behavior logs: ${incidents.total ?? 0} incidents (high: ${incidents.high ?? 0}).`,
    `Advisory risk: ${signals.riskStatus || 'Low'}. ${toneLead}`,
  ].join(' ');

  const parentSummary = [
    `Student: ${studentName}`,
    `Subject: ${subject}`,
    `Status: ${signals.academicDirection || 'Stable'} progress with attendance pattern noted as ${signals.attendancePattern || 'stable'}.`,
    `What to do this week: set a fixed review schedule, monitor assignment completion, and follow up after each quiz.`,
    `School note: this is advisory guidance and will be reviewed by the teacher before final communication.`,
  ].join('\n');

  return {
    teacherInternalSummary,
    parentSummary,
  };
};

const generateFeedbackDraft = async ({ studentName, subject, tone = 'neutral', signals = {} }) => {
  const normalizedTone = toneLabel(tone);

  if (!process.env.OPENROUTER_API_KEY) {
    return fallbackFeedbackDraft({ studentName, subject, tone: normalizedTone, signals });
  }

  try {
    const response = await callOpenRouter({
      model: OPENROUTER_MODEL,
      temperature: 0.35,
      maxTokens: 900,
      messages: [
        {
          role: 'system',
          content:
            'You are an educational analyst. Return only JSON with keys teacherInternalSummary and parentSummary.',
        },
        {
          role: 'user',
          content: [
            `Student: ${studentName}`,
            `Subject: ${subject}`,
            `Tone: ${normalizedTone}`,
            buildParentVoice(normalizedTone),
            'Teacher Internal Summary requirements: analytical, direct, concise, evidence-based.',
            'Parent Summary requirements: structured, clear, calm, action-oriented.',
            'Do not include punishment language or deterministic claims. Do not expose hidden scoring weights.',
            'Use the following signal data:',
            buildSignalsText(signals),
            'Return strict JSON only.',
          ].join('\n\n'),
        },
      ],
    });

    const parsed = extractJsonPayload(response);
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('Invalid AI JSON payload.');
    }

    const teacherInternalSummary = asTrimmed(parsed.teacherInternalSummary);
    const parentSummary = asTrimmed(parsed.parentSummary);

    if (!teacherInternalSummary || !parentSummary) {
      throw new Error('AI response is missing summary fields.');
    }

    return {
      teacherInternalSummary,
      parentSummary,
    };
  } catch {
    return fallbackFeedbackDraft({ studentName, subject, tone: normalizedTone, signals });
  }
};

const fallbackTermComment = ({ studentName, subject, tone, termLabel, signals }) => {
  const grades = signals.grades || {};
  const attendance = signals.attendance || {};
  const incidents = signals.incidents || {};

  const toneSentence =
    tone === 'firm'
      ? 'A stricter weekly follow-through is needed to secure consistent outcomes.'
      : tone === 'encouraging'
        ? 'Continued effort can convert recent gains into steady long-term progress.'
        : 'Consistent routines will stabilize performance further.';

  return {
    academicComment: `${studentName} showed ${signals.academicDirection || 'stable'} performance in ${subject} during ${termLabel}. Latest recorded level is ${grades.latestPercentage ?? 'N/A'}%. ${toneSentence}`,
    behaviorReflection: `Behavior logs this term indicate ${incidents.total ?? 0} recorded incident(s), with high-severity count at ${incidents.high ?? 0}. Classroom conduct should remain a monitored support area.`,
    attendanceNote: `Attendance trend: ${attendance.attendancePercentage ?? 'N/A'}% (${attendance.absent ?? 0} absences, ${attendance.late ?? 0} late records). Regular attendance remains essential for academic continuity.`,
    improvementRecommendation: `Recommendation: keep a structured revision plan, complete pending tasks early, and maintain weekly teacher-parent check-ins on progress indicators.`,
  };
};

const generateTermReportComment = async ({
  studentName,
  subject,
  tone = 'neutral',
  termLabel = 'the current term',
  signals = {},
}) => {
  const normalizedTone = toneLabel(tone);

  if (!process.env.OPENROUTER_API_KEY) {
    return fallbackTermComment({
      studentName,
      subject,
      tone: normalizedTone,
      termLabel,
      signals,
    });
  }

  try {
    const response = await callOpenRouter({
      model: OPENROUTER_MODEL,
      temperature: 0.42,
      maxTokens: 1100,
      messages: [
        {
          role: 'system',
          content:
            'You write individualized term report comments for schools. Return only JSON with keys academicComment, behaviorReflection, attendanceNote, improvementRecommendation.',
        },
        {
          role: 'user',
          content: [
            `Student: ${studentName}`,
            `Subject: ${subject}`,
            `Term label: ${termLabel}`,
            `Tone: ${normalizedTone}`,
            buildParentVoice(normalizedTone),
            'Constraints:',
            '- Do not use punishment language.',
            '- Avoid copy-paste template feel. Make it specific to the signal data.',
            '- Keep each field 1-3 sentences.',
            '- No hidden scoring weights or opaque calculations.',
            'Signal data:',
            buildSignalsText(signals),
            'Return strict JSON only.',
          ].join('\n\n'),
        },
      ],
    });

    const parsed = extractJsonPayload(response);
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('Invalid AI JSON payload.');
    }

    const academicComment = asTrimmed(parsed.academicComment);
    const behaviorReflection = asTrimmed(parsed.behaviorReflection);
    const attendanceNote = asTrimmed(parsed.attendanceNote);
    const improvementRecommendation = asTrimmed(parsed.improvementRecommendation);

    if (!academicComment || !behaviorReflection || !attendanceNote || !improvementRecommendation) {
      throw new Error('AI response is missing comment fields.');
    }

    return {
      academicComment,
      behaviorReflection,
      attendanceNote,
      improvementRecommendation,
    };
  } catch {
    return fallbackTermComment({
      studentName,
      subject,
      tone: normalizedTone,
      termLabel,
      signals,
    });
  }
};

module.exports = {
  buildGradeSheetPreview,
  generateFeedbackDraft,
  generateTermReportComment,
  toneLabel,
};
