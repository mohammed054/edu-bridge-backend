
const ClassModel = require('../models/Class');
const Feedback = require('../models/Feedback');
const Homework = require('../models/Homework');
const SurveyResponse = require('../models/SurveyResponse');
const User = require('../models/User');

const POSITIVE_FEEDBACK_CATEGORIES = new Set(['academic']);
const NEGATIVE_FEEDBACK_CATEGORIES = new Set(['behavior']);

const POSITIVE_WORDS = [
  'excellent',
  'great',
  'good',
  'improved',
  'positive',
  'helpful',
  'happy',
  'satisfied',
  'positive',
];

const NEGATIVE_WORDS = [
  'bad',
  'poor',
  'weak',
  'negative',
  'issue',
  'problem',
  'concern',
  'unsatisfied',
  'negative',
];

const DAY_MS = 24 * 60 * 60 * 1000;

const asTrimmed = (value) => String(value || '').trim();

const containsAny = (text, dictionary) => dictionary.some((keyword) => text.includes(keyword));

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const round = (value, digits = 2) => Number(Number(value || 0).toFixed(digits));

const computeFeedbackSentiment = (rawText) => {
  const text = asTrimmed(rawText).toLowerCase();

  if (!text) {
    return 'neutral';
  }

  const isPositive = containsAny(text, POSITIVE_WORDS);
  const isNegative = containsAny(text, NEGATIVE_WORDS);

  if (isPositive && !isNegative) {
    return 'positive';
  }

  if (isNegative && !isPositive) {
    return 'negative';
  }

  return 'neutral';
};

const isPositiveFeedback = (feedback) => {
  const categories = [...new Set([feedback.category, ...(feedback.categories || [])].filter(Boolean))];

  if (categories.some((category) => POSITIVE_FEEDBACK_CATEGORIES.has(category))) {
    return true;
  }

  if (categories.some((category) => NEGATIVE_FEEDBACK_CATEGORIES.has(category))) {
    return false;
  }

  const content = feedback.content || feedback.message || feedback.text || '';
  return computeFeedbackSentiment(content) === 'positive';
};

const getClassEntry = (store, className) => {
  const normalizedClassName = asTrimmed(className);
  if (!normalizedClassName) {
    return null;
  }

  if (!store[normalizedClassName]) {
    store[normalizedClassName] = {
      className: normalizedClassName,
      examTotal: 0,
      examCount: 0,
      homeworkDone: 0,
      homeworkTotal: 0,
      positiveFeedbackCount: 0,
      feedbackTotal: 0,
      averageGrade: 0,
      homeworkCompletionRate: 0,
      positiveFeedbackRatio: 0,
      performanceScore: 0,
    };
  }

  return store[normalizedClassName];
};

const buildClassPerformance = ({ classes, students, homeworks, feedbacks }) => {
  const classStore = {};

  classes.forEach((item) => {
    getClassEntry(classStore, item.name);
  });

  students.forEach((student) => {
    const className = (student.classes || [])[0] || '';
    const bucket = getClassEntry(classStore, className);

    if (!bucket) {
      return;
    }

    (student.examMarks || []).forEach((mark) => {
      bucket.examTotal += Number(mark.score || 0);
      bucket.examCount += 1;
    });
  });

  homeworks.forEach((homework) => {
    const bucket = getClassEntry(classStore, homework.className);
    if (!bucket) {
      return;
    }

    (homework.assignments || []).forEach((assignment) => {
      bucket.homeworkTotal += 1;
      if (['submitted', 'graded'].includes(assignment.status)) {
        bucket.homeworkDone += 1;
      }
    });
  });

  feedbacks.forEach((feedback) => {
    const bucket = getClassEntry(classStore, feedback.className);
    if (!bucket) {
      return;
    }

    bucket.feedbackTotal += 1;
    if (isPositiveFeedback(feedback)) {
      bucket.positiveFeedbackCount += 1;
    }
  });

  const output = Object.values(classStore).map((entry) => {
    const averageGrade = entry.examCount ? entry.examTotal / entry.examCount : 0;
    const homeworkCompletionRate = entry.homeworkTotal
      ? (entry.homeworkDone / entry.homeworkTotal) * 100
      : 0;
    const positiveFeedbackRatio = entry.feedbackTotal
      ? entry.positiveFeedbackCount / entry.feedbackTotal
      : 0;

    const performanceScore =
      0.6 * averageGrade +
      0.2 * homeworkCompletionRate +
      0.2 * (positiveFeedbackRatio * 100);

    return {
      className: entry.className,
      averageGrade: round(averageGrade),
      homeworkCompletionRate: round(homeworkCompletionRate),
      positiveFeedbackRatio: round(positiveFeedbackRatio * 100),
      performanceScore: round(clamp(performanceScore, 0, 100)),
    };
  });

  return output.sort((left, right) => right.performanceScore - left.performanceScore);
};

const buildMostActiveTeacher = ({ teachers, feedbacks, homeworks, students }) => {
  const scoreByTeacher = {};

  const addScore = (teacherId, value) => {
    const id = asTrimmed(teacherId);
    if (!id) {
      return;
    }

    scoreByTeacher[id] = Number(scoreByTeacher[id] || 0) + Number(value || 0);
  };

  feedbacks.forEach((feedback) => {
    if (feedback.senderRole === 'teacher' && feedback.senderId) {
      addScore(feedback.senderId, 1);
    }
  });

  homeworks.forEach((homework) => {
    addScore(homework.teacherId, 2);
  });

  students.forEach((student) => {
    (student.examMarks || []).forEach((mark) => {
      addScore(mark.teacherId, 1);
    });
  });

  const teacherById = teachers.reduce((acc, item) => {
    acc[String(item._id)] = item;
    return acc;
  }, {});

  const ranked = Object.entries(scoreByTeacher)
    .map(([teacherId, score]) => ({
      teacherId,
      score: Number(score),
      teacher: teacherById[teacherId] || null,
    }))
    .sort((left, right) => right.score - left.score);

  if (!ranked.length) {
    return null;
  }

  const top = ranked[0];
  return {
    id: top.teacherId,
    name: top.teacher?.name || 'N/A',
    activityScore: round(top.score, 0),
  };
};
const buildFeedbackTrend = (feedbacks) => {
  const now = Date.now();
  const currentWindowStart = now - 30 * DAY_MS;
  const previousWindowStart = now - 60 * DAY_MS;

  let currentCount = 0;
  let previousCount = 0;

  feedbacks.forEach((feedback) => {
    const createdAt = new Date(feedback.createdAt).getTime();

    if (createdAt >= currentWindowStart) {
      currentCount += 1;
      return;
    }

    if (createdAt >= previousWindowStart && createdAt < currentWindowStart) {
      previousCount += 1;
    }
  });

  const changePct = previousCount
    ? ((currentCount - previousCount) / previousCount) * 100
    : currentCount > 0
      ? 100
      : 0;

  return {
    currentCount,
    previousCount,
    changePct: round(changePct),
  };
};

const buildSurveySentiment = (responses) => {
  const counters = {
    positive: 0,
    neutral: 0,
    negative: 0,
    totalAnswers: 0,
  };

  const push = (sentiment) => {
    counters.totalAnswers += 1;
    counters[sentiment] += 1;
  };

  responses.forEach((response) => {
    (response.answers || []).forEach((answer) => {
      if (answer.ratingValue !== null && answer.ratingValue !== undefined) {
        const ratingValue = Number(answer.ratingValue);
        if (Number.isNaN(ratingValue)) {
          return;
        }

        if (ratingValue >= 4) {
          push('positive');
          return;
        }

        if (ratingValue <= 2) {
          push('negative');
          return;
        }

        push('neutral');
        return;
      }

      const text =
        asTrimmed(answer.textAnswer) ||
        (Array.isArray(answer.selectedOptions) ? answer.selectedOptions.join(' ') : '');

      if (!asTrimmed(text)) {
        return;
      }

      push(computeFeedbackSentiment(text));
    });
  });

  const denominator = Math.max(1, counters.totalAnswers);

  return {
    ...counters,
    positivePct: round((counters.positive / denominator) * 100),
    neutralPct: round((counters.neutral / denominator) * 100),
    negativePct: round((counters.negative / denominator) * 100),
  };
};

const buildAdminAiAnalytics = async () => {
  const [classes, students, teachers, feedbacks, homeworks, surveyResponses] = await Promise.all([
    ClassModel.find({}, { name: 1 }).lean(),
    User.find({ role: 'student' }, { classes: 1, examMarks: 1 }).lean(),
    User.find({ role: 'teacher' }, { name: 1, email: 1 }).lean(),
    Feedback.find(
      {},
      { className: 1, category: 1, categories: 1, content: 1, message: 1, text: 1, senderId: 1, senderRole: 1, createdAt: 1 }
    ).lean(),
    Homework.find({}, { className: 1, assignments: 1, teacherId: 1 }).lean(),
    SurveyResponse.find({}, { answers: 1 }).lean(),
  ]);

  const classPerformance = buildClassPerformance({
    classes,
    students,
    homeworks,
    feedbacks,
  });

  const topPerformingClass = classPerformance.length ? classPerformance[0] : null;
  const atRiskClass = classPerformance.length ? classPerformance[classPerformance.length - 1] : null;

  const mostActiveTeacher = buildMostActiveTeacher({
    teachers,
    feedbacks,
    homeworks,
    students,
  });

  const feedbackTrend = buildFeedbackTrend(feedbacks);
  const surveySentiment = buildSurveySentiment(surveyResponses);

  return {
    generatedAt: new Date().toISOString(),
    topPerformingClass,
    atRiskClass,
    mostActiveTeacher,
    feedbackTrendChangePct: feedbackTrend.changePct,
    feedbackTrend,
    surveySentiment,
    classTrends: classPerformance,
  };
};

module.exports = {
  buildAdminAiAnalytics,
};
