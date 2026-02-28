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

const asTrimmed = (value) => String(value || '').trim();

const normalizeDigits = (value) =>
  String(value || '')
    .split('')
    .map((char) => ARABIC_DIGIT_MAP[char] || char)
    .join('');

const normalizeWhitespace = (value) => asTrimmed(value).replace(/\s+/g, ' ');

const normalizeTimeText = (value) => {
  const normalized = normalizeDigits(value).replace(/[hH]/g, ':').replace(/[.]/g, ':');
  const compactMatch = asTrimmed(normalized).match(/^([01]?\d|2[0-3])([0-5]\d)$/);
  if (compactMatch) {
    return `${compactMatch[1].padStart(2, '0')}:${compactMatch[2]}`;
  }

  const hhmmMatch = asTrimmed(normalized).match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (!hhmmMatch) {
    return '';
  }

  return `${hhmmMatch[1].padStart(2, '0')}:${hhmmMatch[2]}`;
};

const parseTimeRange = (value) => {
  const text = normalizeDigits(value);
  const match = text.match(
    /([01]?\d|2[0-3])[:.]([0-5]\d)\s*(?:-|–|—|to|الى|إلى)\s*([01]?\d|2[0-3])[:.]([0-5]\d)/i
  );

  if (!match) {
    return { startTime: '', endTime: '' };
  }

  return {
    startTime: `${String(match[1]).padStart(2, '0')}:${match[2]}`,
    endTime: `${String(match[3]).padStart(2, '0')}:${match[4]}`,
  };
};

const normalizeImportedRow = (row) => {
  const timeRange =
    parseTimeRange(
      row?.timeRange || row?.time || row?.slot || row?.period || `${row?.startTime || ''}-${row?.endTime || ''}`
    ) || {};

  const startTime = normalizeTimeText(row?.startTime || row?.start || row?.from || timeRange.startTime || '');
  const endTime = normalizeTimeText(row?.endTime || row?.end || row?.to || timeRange.endTime || '');

  return {
    day: normalizeWhitespace(row?.day || row?.dayName || row?.weekday || row?.dow || ''),
    startTime,
    endTime,
    subject: normalizeWhitespace(row?.subject || row?.course || row?.lesson || ''),
    teacherName: normalizeWhitespace(row?.teacherName || row?.teacher || row?.instructor || ''),
    teacherId: asTrimmed(row?.teacherId || ''),
    room: normalizeWhitespace(row?.room || row?.classroom || row?.location || ''),
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
    // continue
  }

  const arrayStart = text.indexOf('[');
  const arrayEnd = text.lastIndexOf(']');
  if (arrayStart >= 0 && arrayEnd > arrayStart) {
    try {
      return JSON.parse(text.slice(arrayStart, arrayEnd + 1));
    } catch {
      // continue
    }
  }

  const objectStart = text.indexOf('{');
  const objectEnd = text.lastIndexOf('}');
  if (objectStart >= 0 && objectEnd > objectStart) {
    try {
      return JSON.parse(text.slice(objectStart, objectEnd + 1));
    } catch {
      return null;
    }
  }

  return null;
};

const callOpenRouter = async ({ messages, model = OPENROUTER_MODEL, temperature = 0, maxTokens = 1400 }) => {
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error('OPENROUTER_API_KEY is missing.');
  }

  const response = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': process.env.OPENROUTER_SITE_URL || 'http://localhost:5000',
      'X-Title': 'Edu Bridge Schedule Import',
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

const runAiScheduleExtraction = async ({ fileDataUrl = '', ocrText = '' }) => {
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
        'Extract weekly class schedule rows from the provided data.',
        'Return only valid JSON with this exact schema:',
        '{"rows":[{"day":"Monday","startTime":"08:00","endTime":"08:45","subject":"Math","teacherName":"Teacher Name","room":"A-12"}],"notes":[]}',
        'Rules:',
        '- Detect Arabic and English day names.',
        '- Keep times in 24h HH:mm format.',
        '- If time appears as a range, split into startTime and endTime.',
        '- Keep subject and teacher text exactly as detected when possible.',
        '- Include room when available, else empty string.',
        '- Ignore decorative or non-schedule rows.',
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
      maxTokens: 1400,
      messages: [
        {
          role: 'system',
          content: 'You are a strict OCR schedule extraction assistant. Return only valid JSON.',
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

    const rows = Array.isArray(parsed.rows) ? parsed.rows.map(normalizeImportedRow) : [];
    const notes = Array.isArray(parsed.notes)
      ? parsed.notes.map((item) => normalizeWhitespace(item)).filter(Boolean)
      : [];

    return {
      rows,
      notes,
      source: 'ai',
    };
  } catch {
    return null;
  }
};

const parseRowsFromPlainText = ({ ocrText = '' }) => {
  const lines = String(ocrText || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const dayPattern =
    /(monday|mon|tuesday|tue|wednesday|wed|thursday|thu|friday|fri|saturday|sat|sunday|sun|الاثنين|الإثنين|الثلاثاء|الأربعاء|الخميس|الجمعة|السبت|الأحد|الاحد)/i;

  const rows = [];

  lines.forEach((line) => {
    const normalizedLine = normalizeDigits(line);
    const dayMatch = normalizedLine.match(dayPattern);
    const timeRange = parseTimeRange(normalizedLine);

    if (!dayMatch && (!timeRange.startTime || !timeRange.endTime)) {
      return;
    }

    let residual = normalizedLine;
    if (dayMatch) {
      residual = residual.replace(dayMatch[0], ' ');
    }
    if (timeRange.startTime && timeRange.endTime) {
      residual = residual.replace(
        /([01]?\d|2[0-3])[:.]([0-5]\d)\s*(?:-|–|—|to|الى|إلى)\s*([01]?\d|2[0-3])[:.]([0-5]\d)/i,
        ' '
      );
    }

    const parts = residual
      .split(/\s*[|،,;]\s*|\s{2,}/)
      .map((item) => item.trim())
      .filter(Boolean);

    rows.push(
      normalizeImportedRow({
        day: dayMatch ? dayMatch[0] : '',
        startTime: timeRange.startTime,
        endTime: timeRange.endTime,
        subject: parts[0] || '',
        teacherName: parts[1] || '',
        room: parts.slice(2).join(' '),
      })
    );
  });

  return {
    rows,
    notes: rows.length
      ? []
      : ['No structured schedule rows were found in OCR text. Edit extracted rows manually before import.'],
    source: 'text',
  };
};

const extractScheduleRows = async ({ rows = [], ocrText = '', fileDataUrl = '' }) => {
  const manualRows = Array.isArray(rows) ? rows.map(normalizeImportedRow).filter((row) => Object.values(row).some(Boolean)) : [];
  if (manualRows.length) {
    return {
      rows: manualRows,
      notes: [],
      source: 'manual',
    };
  }

  const aiExtraction = await runAiScheduleExtraction({ fileDataUrl, ocrText });
  if (aiExtraction?.rows?.length) {
    return aiExtraction;
  }

  return parseRowsFromPlainText({ ocrText });
};

module.exports = {
  extractScheduleRows,
};
