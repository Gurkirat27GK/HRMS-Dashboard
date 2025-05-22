const express = require('express');
const Attendance = require('../models/Attendance');
const Employee = require('../models/Employee');
const auth = require('../middleware/auth');

const router = express.Router();

// @route   GET api/attendance
// @desc    Get all attendance records
// @access  Private
router.get('/', auth, async (req, res) => {
  try {
    const { date, employee, status, sort } = req.query;
    let query = {};
    
    // Filter by date
    if (date) {
      const startDate = new Date(date);
      startDate.setHours(0, 0, 0, 0);
      
      const endDate = new Date(date);
      endDate.setHours(23, 59, 59, 999);
      
      query.date = { $gte: startDate, $lte: endDate };
    }
    
    // Filter by employee
    if (employee) {
      query.employee = employee;
    }
    
    // Filter by status
    if (status) {
      query.status = status;
    }
    
    // Sort options
    let sortOption = { date: -1 }; // Default: newest first
    if (sort === 'employee') {
      sortOption = { employee: 1 };
    } else if (sort === 'status') {
      sortOption = { status: 1 };
    }
    
    const attendance = await Attendance.find(query)
      .populate('employee', 'name position department')
      .sort(sortOption);
    
    res.json(attendance);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
});

// @route   POST api/attendance
// @desc    Create an attendance record
// @access  Private
router.post('/', auth, async (req, res) => {
  try {
    const { employee, date, status } = req.body;
    
    // Check if employee exists and is active
    const employeeRecord = await Employee.findById(employee);
    if (!employeeRecord) {
      return res.status(404).json({ message: 'Employee not found' });
    }
    
    if (employeeRecord.status !== 'active') {
      return res.status(400).json({ message: 'Only active employees can have attendance records' });
    }
    
    // Check if attendance record already exists for this employee on this date
    const existingAttendance = await Attendance.findOne({
      employee,
      date: new Date(date)
    });
    
    if (existingAttendance) {
      return res.status(400).json({ message: 'Attendance record already exists for this employee on this date' });
    }
    
    // Create new attendance record
    const newAttendance = new Attendance({
      employee,
      date: new Date(date),
      status,
      createdBy: req.user.id
    });
    
    const attendance = await newAttendance.save();
    
    // Populate employee details
    await attendance.populate('employee', 'name position department');
    
    res.json(attendance);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
});

// @route   PUT api/attendance/:id
// @desc    Update an attendance record
// @access  Private
router.put('/:id', auth, async (req, res) => {
  try {
    const { status } = req.body;
    
    let attendance = await Attendance.findById(req.params.id);
    
    if (!attendance) {
      return res.status(404).json({ message: 'Attendance record not found' });
    }
    
    // Update attendance
    attendance = await Attendance.findByIdAndUpdate(
      req.params.id,
      { $set: { status } },
      { new: true }
    ).populate('employee', 'name position department');
    
    res.json(attendance);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
});

// @route   DELETE api/attendance/:id
// @desc    Delete an attendance record
// @access  Private
router.delete('/:id', auth, async (req, res) => {
  try {
    const attendance = await Attendance.findById(req.params.id);
    
    if (!attendance) {
      return res.status(404).json({ message: 'Attendance record not found' });
    }
    
    await attendance.remove();
    res.json({ message: 'Attendance record removed' });
  } catch (err) {
    console.error(err.message);
    if (err.kind === 'ObjectId') {
      return res.status(404).json({ message: 'Attendance record not found' });
    }
    res.status(500).send('Server error');
  }
});

// @route   GET api/attendance/report
// @desc    Get attendance report
// @access  Private
router.get('/report', auth, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    if (!startDate || !endDate) {
      return res.status(400).json({ message: 'Start date and end date are required' });
    }
    
    const start = new Date(startDate);
    start.setHours(0, 0, 0, 0);
    
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);
    
    // Get all active employees
    const employees = await Employee.find({ status: 'active' }).select('name position department');
    
    // Get attendance records for the date range
    const attendanceRecords = await Attendance.find({
      date: { $gte: start, $lte: end }
    }).populate('employee', 'name position department');
    
    // Create report
    const report = employees.map(employee => {
      const employeeAttendance = attendanceRecords.filter(record => 
        record.employee._id.toString() === employee._id.toString()
      );
      
      const present = employeeAttendance.filter(record => record.status === 'present').length;
      const absent = employeeAttendance.filter(record => record.status === 'absent').length;
      const halfDay = employeeAttendance.filter(record => record.status === 'half-day').length;
      const leave = employeeAttendance.filter(record => record.status === 'leave').length;
      
      return {
        employee: {
          _id: employee._id,
          name: employee.name,
          position: employee.position,
          department: employee.department
        },
        attendance: {
          present,
          absent,
          halfDay,
          leave,
          total: present + absent + halfDay + leave
        }
      };
    });
    
    res.json(report);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
});

module.exports = router;