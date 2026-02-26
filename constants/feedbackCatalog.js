const FEEDBACK_CATEGORIES = [
  {
    key: 'technical_issue',
    label: 'مشكلة تقنية',
    options: [],
  },
  {
    key: 'suggestion',
    label: 'اقتراح',
    options: [],
  },
  {
    key: 'complaint',
    label: 'شكوى',
    options: [],
  },
  {
    key: 'question',
    label: 'استفسار',
    options: [],
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
