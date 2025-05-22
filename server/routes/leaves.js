const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const Leave = require('../models/Leave');
const Employee = require('../models/Employee');
const Attendance = require('../models/Attendance');
const auth = require('../middleware/auth');

const router = express.Router();

// Set up multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = 'uploads/documents';
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
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    const filetypes = /pdf|doc|docx|jpg|jpeg|png/;
    const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = filetypes.test(file.mimetype);
    
    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Only PDF, DOC, DOCX, JPG, JPEG, and PNG files are allowed'));
    }
  }
});

// @route   GET api/leaves
// @desc    Get all leaves
// @access  Private
router.get('/', auth, async (req, res) => {
  try {
    const { employee, status, type, startDate, endDate, sort } = req.query;
    let query = {};
    
    // Filter by employee
    if (employee) {
      query.employee = employee;
    }
    
    // Filter by status
    if (status) {
      query.status = status;
    }
    
    // Filter by type
    if (type) {
      query.type = type;
    }
    
    // Filter by date range
    if (startDate && endDate) {
      query.$or = [
        { startDate: { $gte: new Date(startDate), $lte: new Date(endDate) } },
        { endDate: { $gte: new Date(startDate), $lte: new Date(endDate) } },
        {
          $and: [
            { startDate: { $lte: new Date(startDate) } },
            { endDate: { $gte: new Date(endDate) } }
          ]
        }
      ];
    }
    
    // Sort options
    let sortOption = { createdAt: -1 }; // Default: newest first
    if (sort === 'employee') {
      sortOption = { employee: 1 };
    } else if (sort === 'startDate') {
      sortOption = { startDate: 1 };
    }
    
    const leaves = await Leave.find(query)
      .populate('employee', 'name position department')
      .sort(sortOption);
    
    res.json(leaves);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
});

// @route   POST api/leaves
// @desc    Create a leave
// @access  Private
router.post('/', auth, upload.single('document'), async (req, res) => {
  try {
    const { employee, startDate, endDate, reason, type } = req.body;
    
    // Check if employee exists and is active
    const employeeRecord = await Employee.findById(employee);
    if (!employeeRecord) {
      return res.status(404).json({ message: 'Employee not found' });
    }
    
    if (employeeRecord.status !== 'active') {
      return res.status(400).json({ message: 'Only active employees can apply for leave' });
    }
    
    // Check if employee has attendance record with 'present' status
    const hasAttendance = await Attendance.findOne({
      employee,
      status: 'present'
    });
    
    if (!hasAttendance) {
      return res.status(400).json({ message: 'Only employees with attendance records can apply for leave' });
    }
    
    // Check for overlapping leaves
    const overlappingLeave = await Leave.findOne({
      employee,
      $or: [
        { startDate: { $lte: new Date(endDate), $gte: new Date(startDate) } },
        { endDate: { $gte: new Date(startDate), $lte: new Date(endDate) } },
        {
          $and: [
            { startDate: { $lte: new Date(startDate) } },
            { endDate: { $gte: new Date(endDate) } }
          ]
        }
      ]
    });
    
    if (overlappingLeave) {
      return res.status(400).json({ message: 'Leave application overlaps with existing leave' });
    }
    
    // Create new leave
    const newLeave = new Leave({
      employee,
      startDate: new Date(startDate),
      endDate: new Date(endDate),
      reason,
      type,
      document: req.file ? `/uploads/documents/${req.file.filename}` : '',
      createdBy: req.user.id
    });
    
    const leave = await newLeave.save();
    
    // Populate employee details
    await leave.populate('employee', 'name position department');
    
    res.json(leave);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
});

// @route   GET api/leaves/:id
// @desc    Get leave by ID
// @access  Private
router.get('/:id', auth, async (req, res) => {
  try {
    const leave = await Leave.findById(req.params.id)
      .populate('employee', 'name position department');
    
    if (!leave) {
      return res.status(404).json({ message: 'Leave not found' });
    }
    
    res.json(leave);
  } catch (err) {
    console.error(err.message);
    if (err.kind === 'ObjectId') {
      return res.status(404).json({ message: 'Leave not found' });
    }
    res.status(500).send('Server error');
  }
});

// @route   PUT api/leaves/:id
// @desc    Update a leave
// @access  Private
router.put('/:id', auth, upload.single('document'), async (req, res) => {
  try {
    const { status } = req.body;
    
    let leave = await Leave.findById(req.params.id);
    
    if (!leave) {
      return res.status(404).json({ message: 'Leave not found' });
    }
    
    // Build leave object
    const leaveFields = {};
    if (status) leaveFields.status = status;
    if (req.file) leaveFields.document = `/uploads/documents/${req.file.filename}`;
    
    leaveFields.updatedBy = req.user.id;
    leaveFields.updatedAt = Date.now();
    
    // Update leave
    leave = await Leave.findByIdAndUpdate(
      req.params.id,
      { $set: leaveFields },
      { new: true }
    ).populate('employee', 'name position department');
    
    // If leave is approved, update attendance records
    if (status === 'approved') {
      const start = new Date(leave.startDate);
      start.setHours(0, 0, 0, 0);
      
      const end = new Date(leave.endDate);
      end.setHours(23, 59, 59, 999);
      
      // Create a date range
      const dateRange = [];
      let currentDate = new Date(start);
      
      while (currentDate <= end) {
        dateRange.push(new Date(currentDate));
        currentDate.setDate(currentDate.getDate() + 1);
      }
      
      // Update or create attendance records for each day
      for (const date of dateRange) {
        // Check if attendance record exists
        let attendance = await Attendance.findOne({
          employee: leave.employee,
          date: {
            $gte: new Date(date.setHours(0, 0, 0, 0)),
            $lte: new Date(date.setHours(23, 59, 59, 999))
          }
        });
        
        if (attendance) {
          // Update existing attendance
          attendance.status = 'leave';
          await attendance.save();
        } else {
          // Create new attendance record
          const newAttendance = new Attendance({
            employee: leave.employee,
            date,
            status: 'leave',
            createdBy: req.user.id
          });
          
          await newAttendance.save();
        }
      }
    }
    
    res.json(leave);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
});

// @route   DELETE api/leaves/:id
// @desc    Delete a leave
// @access  Private
router.delete('/:id', auth, async (req, res) => {
  try {
    const leave = await Leave.findById(req.params.id);
    
    if (!leave) {
      return res.status(404).json({ message: 'Leave not found' });
    }
    
    await leave.remove();
    res.json({ message: 'Leave removed' });
  } catch (err) {
    console.error(err.message);
    if (err.kind === 'ObjectId') {
      return res.status(404).json({ message: 'Leave not found' });
    }
    res.status(500).send('Server error');
  }
});

// @route   GET api/leaves/:id/document
// @desc    Download leave document
// @access  Private
router.get('/:id/document', auth, async (req, res) => {
  try {
    const leave = await Leave.findById(req.params.id);
    
    if (!leave) {
      return res.status(404).json({ message: 'Leave not found' });
    }
    
    if (!leave.document) {
      return res.status(404).json({ message: 'Document not found' });
    }
    
    const documentPath = path.join(__dirname, '..', leave.document);
    res.download(documentPath);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
});

// @route   GET api/leaves/calendar
// @desc    Get leaves for calendar
// @access  Private
router.get('/calendar', auth, async (req, res) => {
  try {
    const { month, year } = req.query;
    
    if (!month || !year) {
      return res.status(400).json({ message: 'Month and year are required' });
    }
    
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0);
    
    // Get approved leaves for the month
    const leaves = await Leave.find({
      status: 'approved',
      $or: [
        { startDate: { $gte: startDate, $lte: endDate } },
        { endDate: { $gte: startDate, $lte: endDate } },
        {
          $and: [
            { startDate: { $lte: startDate } },
            { endDate: { $gte: endDate } }
          ]
        }
      ]
    }).populate('employee', 'name');
    
    // Format leaves for calendar
    const calendarLeaves = leaves.map(leave => {
      const start = new Date(Math.max(leave.startDate, startDate));
      const end = new Date(Math.min(leave.endDate, endDate));
      
      // Create a date range
      const dateRange = [];
      let currentDate = new Date(start);
      
      while (currentDate <= end) {
        dateRange.push({
          date: new Date(currentDate).toISOString().split('T')[0],
          employee: leave.employee.name,
          type: leave.type
        });
        currentDate.setDate(currentDate.getDate() + 1);
      }
      
      return dateRange;
    });
    
    // Flatten the array
    const flattenedLeaves = calendarLeaves.flat();
    
    res.json(flattenedLeaves);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
});

module.exports = router;