const Student = require('../models/Student');
const { sendServerError } = require('../utils/safeError');

const getStudents = async (req, res) => {
  try {
    const students = await Student.find().populate('classId');
    res.json(students);
  } catch (error) {
    return sendServerError(res, error, 'Failed to load students.');
  }
};

const createStudent = async (req, res) => {
  try {
    const student = new Student(req.body);
    const newStudent = await student.save();
    res.status(201).json(newStudent);
  } catch (error) {
    res.status(400).json({ message: 'Invalid student payload.' });
  }
};

module.exports = { getStudents, createStudent };
