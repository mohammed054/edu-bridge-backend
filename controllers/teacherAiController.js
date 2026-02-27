const mongoose = require('mongoose');
const User = require('../models/User');
const { buildGradeSheetPreview, generateFeedbackDraft, generateTermReportComment, toneLabel } = require('../services/aiAcademicWorkflowService');
const { buildStudentAiSignals } = require('../services/intelligenceService');
const { sendServerError } = require('../utils/safeError');

const asTrimmed = (value) => String(value || '').trim();

const hasSubjectAccess = (teacherSubjects, subject) =>
  (teacherSubjects || []).some(
    (teacherSubject) => String(teacherSubject || '').toLowerCase() === String(subject || '').toLowerCase()
  );

const hasClassAccess = (teacherClasses, studentClasses) => {
  const classSet = new Set(teacherClasses || []);
  return (studentClasses || []).some((name) => classSet.has(name));
};

const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(asTrimmed(value));

const normalizeExamTitle = (value) => asTrimmed(value) || 'Assessment';

const normalizeScoreInput = (value) => {
  const parsed = Number(value);
  return Number.isNaN(parsed) ? null : parsed;
};

const previewGradeSheetImport = async (req, res) => {
  try {
    const className = asTrimmed(req.body?.className);
    const subject = asTrimmed(req.body?.subject || req.user.subject || req.user.subjects?.[0]);
    const examTitle = normalizeExamTitle(req.body?.examTitle);
    const defaultMaxMarks = Number(req.body?.defaultMaxMarks || 100);
    const ocrText = asTrimmed(req.body?.ocrText);
    const fileDataUrl = asTrimmed(req.body?.fileDataUrl);
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];

    if (!className || !subject) {
      return res.status(400).json({ message: 'Class name and subject are required.' });
    }

    if (!req.user.classes?.includes(className)) {
      return res.status(403).json({ message: 'You are not allowed to import grades for this class.' });
    }

    if (!hasSubjectAccess(req.user.subjects || [], subject)) {
      return res.status(403).json({ message: 'You are not allowed to import grades for this subject.' });
    }

    if (!rows.length && !ocrText && !fileDataUrl) {
      return res.status(400).json({
        message:
          'Upload an image/PDF OCR text or provide extracted rows before running preview.',
      });
    }

    const students = await User.find(
      {
        role: 'student',
        classes: className,
      },
      {
        name: 1,
        classes: 1,
        examMarks: 1,
      }
    ).lean();

    const preview = await buildGradeSheetPreview({
      students,
      subject,
      examTitle,
      defaultMaxMarks: Number.isNaN(defaultMaxMarks) ? 100 : defaultMaxMarks,
      ocrText,
      fileDataUrl,
      rows,
    });

    return res.json({
      confirmationRequired: true,
      overwritePolicy: 'manual_confirmation_required',
      className,
      subject,
      examTitle,
      ...preview,
    });
  } catch (error) {
    return sendServerError(res, error, 'Failed to preview grade sheet import.');
  }
};

const confirmGradeSheetImport = async (req, res) => {
  try {
    const className = asTrimmed(req.body?.className);
    const subject = asTrimmed(req.body?.subject || req.user.subject || req.user.subjects?.[0]);
    const defaultExamTitle = normalizeExamTitle(req.body?.examTitle);
    const confirmImport = req.body?.confirmImport === true;
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];

    if (!className || !subject) {
      return res.status(400).json({ message: 'Class name and subject are required.' });
    }

    if (!confirmImport) {
      return res.status(400).json({
        message: 'Import confirmation is required. No grades were changed.',
      });
    }

    if (!rows.length) {
      return res.status(400).json({ message: 'At least one row is required for import.' });
    }

    if (!req.user.classes?.includes(className)) {
      return res.status(403).json({ message: 'You are not allowed to import grades for this class.' });
    }

    if (!hasSubjectAccess(req.user.subjects || [], subject)) {
      return res.status(403).json({ message: 'You are not allowed to import grades for this subject.' });
    }

    const requestedStudentIds = [...new Set(rows.map((row) => asTrimmed(row.matchedStudentId)).filter(Boolean))];

    const students = await User.find(
      {
        _id: { $in: requestedStudentIds },
        role: 'student',
      },
      {
        name: 1,
        classes: 1,
        examMarks: 1,
      }
    );

    const studentById = students.reduce((acc, student) => {
      acc[String(student._id)] = student;
      return acc;
    }, {});

    let createdCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;
    let unrecognizedCount = 0;

    const skipped = [];

    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index] || {};
      const rowIndex = Number(row.rowIndex ?? index);
      const sourceStudentName = asTrimmed(row.sourceStudentName);

      if (row.skip === true) {
        skippedCount += 1;
        skipped.push({
          rowIndex,
          sourceStudentName,
          reason: 'row_marked_to_skip',
        });
        continue;
      }

      const studentId = asTrimmed(row.matchedStudentId);
      if (!studentId || !isValidObjectId(studentId)) {
        unrecognizedCount += 1;
        skipped.push({
          rowIndex,
          sourceStudentName,
          reason: 'unrecognized_name',
        });
        continue;
      }

      const student = studentById[studentId];
      if (!student || !hasClassAccess(req.user.classes || [], student.classes || []) || !(student.classes || []).includes(className)) {
        skippedCount += 1;
        skipped.push({
          rowIndex,
          sourceStudentName,
          matchedStudentId: studentId,
          reason: 'unauthorized_student',
        });
        continue;
      }

      const score = normalizeScoreInput(row.score);
      const maxMarks = normalizeScoreInput(row.maxMarks);

      if (score === null || maxMarks === null || maxMarks <= 0) {
        skippedCount += 1;
        skipped.push({
          rowIndex,
          sourceStudentName,
          matchedStudentId: studentId,
          reason: 'invalid_numeric_values',
        });
        continue;
      }

      if (score < 0 || score > maxMarks) {
        skippedCount += 1;
        skipped.push({
          rowIndex,
          sourceStudentName,
          matchedStudentId: studentId,
          reason: 'score_out_of_range',
        });
        continue;
      }

      const examTitle = normalizeExamTitle(row.examTitle || defaultExamTitle);
      const existingIndex = (student.examMarks || []).findIndex(
        (item) =>
          String(item.subject || '').toLowerCase() === subject.toLowerCase() &&
          String(item.examTitle || 'Assessment').toLowerCase() === examTitle.toLowerCase()
      );

      const nextMark = {
        subject,
        examTitle,
        score: round((score / maxMarks) * 100, 2),
        rawScore: score,
        maxMarks,
        teacherId: req.user.id,
        teacherName: req.user.name || '',
        updatedAt: new Date(),
      };

      if (existingIndex >= 0) {
        const existing = student.examMarks[existingIndex];
        const existingRaw = existing.rawScore === null || existing.rawScore === undefined
          ? Number(existing.score || 0)
          : Number(existing.rawScore);
        const existingMax = Number(existing.maxMarks || 100) || 100;
        const hasChange = round(existingRaw, 4) !== round(score, 4) || round(existingMax, 4) !== round(maxMarks, 4);

        if (hasChange && row.confirmOverwrite !== true) {
          skippedCount += 1;
          skipped.push({
            rowIndex,
            sourceStudentName,
            matchedStudentId: studentId,
            reason: 'overwrite_confirmation_required',
          });
          continue;
        }

        if (!hasChange) {
          skippedCount += 1;
          skipped.push({
            rowIndex,
            sourceStudentName,
            matchedStudentId: studentId,
            reason: 'no_change_detected',
          });
          continue;
        }

        student.examMarks[existingIndex] = nextMark;
        updatedCount += 1;
      } else {
        student.examMarks.push(nextMark);
        createdCount += 1;
      }

      // eslint-disable-next-line no-await-in-loop
      await student.save();
    }

    return res.json({
      message: 'Grade import completed with explicit confirmation.',
      className,
      subject,
      examTitle: defaultExamTitle,
      createdCount,
      updatedCount,
      importedCount: createdCount + updatedCount,
      skippedCount,
      unrecognizedCount,
      skipped,
    });
  } catch (error) {
    return sendServerError(res, error, 'Failed to import grade sheet.');
  }
};

const getStudentForTeacher = async ({ teacherUser, studentId }) => {
  if (!isValidObjectId(studentId)) {
    return null;
  }

  const student = await User.findOne(
    {
      _id: studentId,
      role: 'student',
    },
    { name: 1, classes: 1 }
  ).lean();

  if (!student) {
    return null;
  }

  const allowed = hasClassAccess(teacherUser.classes || [], student.classes || []);
  return allowed ? student : null;
};

const generateStudentFeedbackDraft = async (req, res) => {
  try {
    const studentId = asTrimmed(req.params?.studentId);
    const subject = asTrimmed(req.body?.subject || req.user.subject || req.user.subjects?.[0]);
    const tone = toneLabel(req.body?.tone || 'neutral');

    if (!subject) {
      return res.status(400).json({ message: 'Subject is required.' });
    }

    if (!hasSubjectAccess(req.user.subjects || [], subject)) {
      return res.status(403).json({ message: 'You are not allowed to generate drafts for this subject.' });
    }

    const student = await getStudentForTeacher({
      teacherUser: req.user,
      studentId,
    });

    if (!student) {
      return res.status(404).json({ message: 'Student not found or not accessible.' });
    }

    const signals = await buildStudentAiSignals(studentId, { subject });

    const draft = await generateFeedbackDraft({
      studentName: student.name,
      subject,
      tone,
      signals,
    });

    return res.json({
      studentId,
      studentName: student.name,
      subject,
      tone,
      signals: {
        academicDirection: signals.academicDirection,
        attendancePattern: signals.attendancePattern,
        behaviorNote: signals.behaviorNote,
        parentEngagementStatus: signals.parentEngagementStatus,
        riskStatus: signals.riskStatus,
        trendShifts: signals.trendShifts || [],
      },
      draft,
      editable: true,
      humanReviewRequired: true,
    });
  } catch (error) {
    return sendServerError(res, error, 'Failed to generate feedback draft.');
  }
};

const generateStudentTermComment = async (req, res) => {
  try {
    const studentId = asTrimmed(req.params?.studentId);
    const subject = asTrimmed(req.body?.subject || req.user.subject || req.user.subjects?.[0]);
    const tone = toneLabel(req.body?.tone || 'neutral');
    const termLabel = asTrimmed(req.body?.termLabel || 'Current term');

    if (!subject) {
      return res.status(400).json({ message: 'Subject is required.' });
    }

    if (!hasSubjectAccess(req.user.subjects || [], subject)) {
      return res.status(403).json({ message: 'You are not allowed to generate comments for this subject.' });
    }

    const student = await getStudentForTeacher({
      teacherUser: req.user,
      studentId,
    });

    if (!student) {
      return res.status(404).json({ message: 'Student not found or not accessible.' });
    }

    const signals = await buildStudentAiSignals(studentId, { subject });

    const comment = await generateTermReportComment({
      studentName: student.name,
      subject,
      tone,
      termLabel,
      signals,
    });

    return res.json({
      studentId,
      studentName: student.name,
      subject,
      tone,
      termLabel,
      comment,
      editable: true,
      humanReviewRequired: true,
    });
  } catch (error) {
    return sendServerError(res, error, 'Failed to generate term report comment.');
  }
};

module.exports = {
  previewGradeSheetImport,
  confirmGradeSheetImport,
  generateStudentFeedbackDraft,
  generateStudentTermComment,
};

function round(value, digits = 2) {
  return Number(Number(value || 0).toFixed(digits));
}
