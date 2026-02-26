const FEEDBACK_CATEGORIES = [
  {
    key: 'academic',
    label: 'أكاديمي',
    options: ['الدرجات', 'المشاركة', 'الواجبات', 'سلوك الامتحان'],
  },
  {
    key: 'behavior',
    label: 'السلوك / الأخلاق',
    options: ['الانضباط', 'التعاون', 'الاحترام', 'الحضور'],
  },
  {
    key: 'misc',
    label: 'أخرى / متنوعة',
    options: ['ملاحظات', 'اقتراحات', 'نصوص حرة'],
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
