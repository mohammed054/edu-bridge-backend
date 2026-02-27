const FEEDBACK_CATEGORIES = [
  {
    key: 'academic',
    label: 'Academic',
    options: [
      "Didn't understand topic",
      'Teacher explained well',
      'Need additional examples',
      'Need revision support',
    ],
  },
  {
    key: 'homework',
    label: 'Homework',
    options: [
      "Didn't submit homework",
      'Struggled with assignment',
      'Completed on time',
      'Need help with time planning',
    ],
  },
  {
    key: 'behavior',
    label: 'Behavior',
    options: [
      'Distracted in class',
      'Helped classmates',
      'Showed respectful conduct',
      'Needs behavior follow-up',
    ],
  },
  {
    key: 'participation',
    label: 'Participation',
    options: [
      "Didn't answer questions",
      'Volunteered answers',
      'Participated consistently',
      'Needs encouragement to engage',
    ],
  },
  {
    key: 'other',
    label: 'Other',
    options: ['Custom note'],
  },
  // Legacy keys kept for existing records compatibility.
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
