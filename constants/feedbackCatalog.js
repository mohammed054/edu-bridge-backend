const FEEDBACK_CATEGORIES = [
  {
    key: 'academic',
    label: 'Academic',
    options: [
      'Difficulty understanding lesson objective',
      'Need targeted revision support',
      'Need more guided examples',
      'Assessment preparation concern',
    ],
  },
  {
    key: 'behavior',
    label: 'Behavior',
    options: [
      'Classroom focus concern',
      'Disruptive interaction observed',
      'Respect and conduct reminder needed',
      'Positive conduct noted',
    ],
  },
  {
    key: 'attendance',
    label: 'Attendance',
    options: [
      'Frequent lateness observed',
      'Absence affecting continuity',
      'Attendance inconsistency this week',
      'Attendance improved this week',
    ],
  },
  {
    key: 'general',
    label: 'General',
    options: [
      'General progress update',
      'Parent follow-up recommended',
      'Request meeting and alignment',
      'Administrative support requested',
    ],
  },
  {
    key: 'urgent',
    label: 'Urgent',
    options: [
      'Immediate intervention required',
      'High-risk pattern detected',
      'Escalate to administration',
      'Parent contact required today',
    ],
  },
  {
    key: 'other',
    label: 'Other',
    options: ['Custom note'],
  },
  // Legacy keys kept for existing records compatibility.
  {
    key: 'homework',
    label: 'General (Legacy)',
    options: ['Homework follow-up'],
  },
  {
    key: 'participation',
    label: 'Behavior (Legacy)',
    options: ['Participation note'],
  },
  {
    key: 'moral',
    label: 'Behavior (Legacy)',
    options: ['General behavior note'],
  },
  {
    key: 'idfk',
    label: 'Other (Legacy)',
    options: ['General note'],
  },
];

const FEEDBACK_CATEGORY_KEYS = FEEDBACK_CATEGORIES.map((item) => item.key);

const FEEDBACK_CATEGORY_LABEL_BY_KEY = FEEDBACK_CATEGORIES.reduce((acc, item) => {
  acc[item.key] = item.label;
  return acc;
}, {});

module.exports = {
  FEEDBACK_CATEGORIES,
  FEEDBACK_CATEGORY_KEYS,
  FEEDBACK_CATEGORY_LABEL_BY_KEY,
};
