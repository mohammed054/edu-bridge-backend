const FEEDBACK_CATEGORIES = [
  {
    key: 'academic',
    label: 'أكاديمي',
    options: ['واجبات', 'اختبارات', 'مشاركة الصف', 'فهم الدرس'],
  },
  {
    key: 'moral',
    label: 'سلوكي',
    options: ['احترام', 'التزام', 'تعاون', 'انضباط'],
  },
  {
    key: 'idfk',
    label: 'أخرى',
    options: ['إداري', 'تقني', 'اقتراح عام'],
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
