const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const Candidate = require('../models/Candidate');
const Employee = require('../models/Employee');
const auth = require('../middleware/auth');

const router = express.Router();

// Multer Storage Configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = 'uploads/resumes';
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const filetypes = /pdf|doc|docx/;
    const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = filetypes.test(file.mimetype);

    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Only PDF, DOC, and DOCX files are allowed'));
    }
  }
});

// GET all candidates
router.get('/', auth, async (req, res) => {
  try {
    const { search, status, sort } = req.query;
    let query = {};

    if (search) {
      query = {
        $or: [
          { name: { $regex: search, $options: 'i' } },
          { email: { $regex: search, $options: 'i' } },
          { position: { $regex: search, $options: 'i' } }
        ]
      };
    }

    if (status) {
      query.status = status;
    }

    let sortOption = { createdAt: -1 };
    if (sort === 'name') sortOption = { name: 1 };
    else if (sort === 'position') sortOption = { position: 1 };

    const candidates = await Candidate.find(query).sort(sortOption);
    res.json(candidates);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
});

// POST create candidate
router.post('/', auth, upload.single('resume'), async (req, res) => {
  try {
    const { name, email, phone, position, experience } = req.body;

    const existingCandidate = await Candidate.findOne({ email });
    if (existingCandidate) {
      return res.status(400).json({ message: 'Candidate with this email already exists' });
    }

    const newCandidate = new Candidate({
      name,
      email,
      phone,
      position,
      experience,
      resume: req.file ? `uploads/resumes/${req.file.filename}` : ''
    });

    const candidate = await newCandidate.save();
    res.json(candidate);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
});

// GET candidate by ID
router.get('/:id', auth, async (req, res) => {
  try {
    const candidate = await Candidate.findById(req.params.id);
    if (!candidate) return res.status(404).json({ message: 'Candidate not found' });
    res.json(candidate);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
});

// PUT update candidate
router.put('/:id', auth, upload.single('resume'), async (req, res) => {
  try {
    const { name, email, phone, position, experience, status } = req.body;

    const candidateFields = {};
    if (name) candidateFields.name = name;
    if (email) candidateFields.email = email;
    if (phone) candidateFields.phone = phone;
    if (position) candidateFields.position = position;
    if (experience) candidateFields.experience = experience;
    if (status) candidateFields.status = status;
    if (req.file) candidateFields.resume = `uploads/resumes/${req.file.filename}`;

    let candidate = await Candidate.findById(req.params.id);
    if (!candidate) return res.status(404).json({ message: 'Candidate not found' });

    candidate = await Candidate.findByIdAndUpdate(
      req.params.id,
      { $set: candidateFields },
      { new: true }
    );

    res.json(candidate);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
});

// DELETE candidate
router.delete('/:id', auth, async (req, res) => {
  try {
    const candidate = await Candidate.findById(req.params.id);
    if (!candidate) return res.status(404).json({ message: 'Candidate not found' });

    await candidate.remove();
    res.json({ message: 'Candidate removed' });
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
});

// Convert candidate to employee
router.post('/:id/convert', auth, async (req, res) => {
  try {
    const { department, joiningDate, salary } = req.body;
    const candidate = await Candidate.findById(req.params.id);

    if (!candidate) return res.status(404).json({ message: 'Candidate not found' });
    if (candidate.status !== 'selected') {
      return res.status(400).json({ message: 'Only selected candidates can be converted to employees' });
    }

    const existingEmployee = await Employee.findOne({ email: candidate.email });
    if (existingEmployee) {
      return res.status(400).json({ message: 'Employee with this email already exists' });
    }

    const newEmployee = new Employee({
      name: candidate.name,
      email: candidate.email,
      phone: candidate.phone,
      position: candidate.position,
      department,
      joiningDate,
      salary,
      candidateId: candidate._id
    });

    const employee = await newEmployee.save();
    candidate.status = 'selected';
    await candidate.save();

    res.json(employee);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
});

// Download candidate resume
router.get('/:id/resume', auth, async (req, res) => {
  try {
    const candidate = await Candidate.findById(req.params.id);
    if (!candidate) return res.status(404).json({ message: 'Candidate not found' });
    if (!candidate.resume) return res.status(404).json({ message: 'Resume not found' });

    const resumePath = path.join(__dirname, '..', candidate.resume);
    res.download(resumePath);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
});

module.exports = router;
