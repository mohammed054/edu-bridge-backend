const Student = require('../models/Student');

const getStudents = async (req, res) => {
  try {
    const students = await Student.find().populate('classId');
    res.json(students);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const createStudent = async (req, res) => {
  try {
    const student = new Student(req.body);
    const newStudent = await student.save();
    res.status(201).json(newStudent);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

module.exports = { getStudents, createStudent };
