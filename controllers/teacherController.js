const Teacher = require('../models/Teacher');
const { sendServerError } = require('../utils/safeError');

const getTeachers = async (req, res) => {
  try {
    const teachers = await Teacher.find();
    res.json(teachers);
  } catch (error) {
    return sendServerError(res, error, 'Failed to load teachers.');
  }
};

const createTeacher = async (req, res) => {
  try {
    const teacher = new Teacher(req.body);
    const newTeacher = await teacher.save();
    res.status(201).json(newTeacher);
  } catch (error) {
    res.status(400).json({ message: 'Invalid teacher payload.' });
  }
};

module.exports = { getTeachers, createTeacher };
