// routes/transcriptParser.js - CUSTOM PDF PARSER SOLUTION
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const pdf = require('pdf-parse');

const router = express.Router();

// Multer configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = 'uploads/';
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + file.originalname);
  }
});

const upload = multer({ 
  storage: storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'));
    }
  },
  limits: {
    fileSize: 10 * 1024 * 1024
  }
});

// Custom transcript parser for University of Mpumalanga format
function parseTranscript(text) {
  const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);
  
  const result = {
    studentInfo: {
      name: '',
      studentNumber: '',
      program: '',
      years: []
    },
    academicRecord: [],
    summary: {
      totalCredits: 0,
      averageMark: 0,
      distinctionCount: 0,
      failedCourses: []
    }
  };

  let currentYear = '';
  let currentSemester = '';
  let currentProgram = '';
  let records = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Extract student name
    if (line.includes('Name :') && !result.studentInfo.name) {
      result.studentInfo.name = line.split('Name :')[1].trim();
    }
    
    // Extract student number
    if (line.includes('Student Number :') && !result.studentInfo.studentNumber) {
      result.studentInfo.studentNumber = line.split('Student Number :')[1].trim();
    }
    
    // Extract program and year
    if (line.includes('Year :') && line.includes('DIPLOMA')) {
      const yearMatch = line.match(/Year : (\d{4})/);
      if (yearMatch) {
        currentYear = yearMatch[1];
        if (!result.studentInfo.years.includes(currentYear)) {
          result.studentInfo.years.push(currentYear);
        }
      }
      
      // Extract program
      const programMatch = line.match(/DIPLOMA IN [A-Z\s]+/);
      if (programMatch && !result.studentInfo.program) {
        result.studentInfo.program = programMatch[0];
        currentProgram = programMatch[0];
      }
    }
    
    // Detect semester
    if (line.includes('SEMESTER ONE') || line.includes('SEMESTER TWO') || line.includes('YEAR BLOCK')) {
      currentSemester = line;
    }
    
    // Parse course lines - looking for pattern: COURSE NAME MARK GRADE CREDITS
    if (currentYear && currentSemester) {
      // This regex matches course lines with marks and grades
      const courseMatch = line.match(/^([A-Z][A-Z\s\d]+?(?=\s+\d{2,3}\s+[A-Z]))\s+(\d{2,3})\s+([A-Z\s]+?(?=\s+\d{2}\s+\d+\.\d{2}|\s*$))\s*(\d{2})?\s*(\d+\.\d{2})?$/);
      
      if (!courseMatch) {
        // Alternative pattern for courses with different formatting
        const altMatch = line.match(/^([A-Z][A-Z\s\d]+)\s+(\d{2,3})\s+(PASS|FAIL|PASS WITH DISTINCTION|SUBM,RE EXAMINATION ALLOW)/);
        if (altMatch) {
          const [, course, mark, grade] = altMatch;
          records.push({
            year: currentYear,
            semester: currentSemester,
            course: course.trim(),
            mark: parseInt(mark),
            grade: grade,
            credits: 10.00, // Default value
            nationalLevel: '06' // Default value
          });
        }
      } else {
        const [, course, mark, grade, level, credits] = courseMatch;
        records.push({
          year: currentYear,
          semester: currentSemester,
          course: course.trim(),
          mark: parseInt(mark),
          grade: grade.trim(),
          credits: credits ? parseFloat(credits) : 10.00,
          nationalLevel: level || '06'
        });
      }
    }
    
    // Handle supplementary exams
    if (line.includes('SUPPLEMENTARY/SPECIAL EXAMS')) {
      currentSemester = 'SUPPLEMENTARY/SPECIAL EXAMS';
    }
  }

  // Additional parsing for specific course patterns
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Look for course patterns with marks between 50-100 followed by PASS/FAIL
    const markMatch = line.match(/(\b\d{2,3}\b)\s+(PASS|FAIL|PASS WITH DISTINCTION|SUBM,RE EXAMINATION ALLOW)/);
    if (markMatch && parseInt(markMatch[1]) >= 50 && parseInt(markMatch[1]) <= 100) {
      const mark = parseInt(markMatch[1]);
      const grade = markMatch[2];
      
      // Find the course name (look backwards in lines)
      let courseName = '';
      for (let j = i - 1; j >= Math.max(0, i - 3); j--) {
        if (lines[j] && !lines[j].match(/\b\d{2,3}\b/) && 
            !lines[j].includes('SEMESTER') && 
            !lines[j].includes('Year :') &&
            lines[j].length > 5) {
          courseName = lines[j];
          break;
        }
      }
      
      if (courseName && !records.find(r => r.course === courseName && r.mark === mark)) {
        records.push({
          year: currentYear,
          semester: currentSemester,
          course: courseName,
          mark: mark,
          grade: grade,
          credits: 10.00,
          nationalLevel: '06'
        });
      }
    }
  }

  // Remove duplicates
  const uniqueRecords = [];
  const seen = new Set();
  records.forEach(record => {
    const key = `${record.course}-${record.year}-${record.mark}`;
    if (!seen.has(key)) {
      seen.add(key);
      uniqueRecords.push(record);
    }
  });

  result.academicRecord = uniqueRecords;

  // Calculate summary
  if (uniqueRecords.length > 0) {
    const totalMarks = uniqueRecords.reduce((sum, record) => sum + record.mark, 0);
    result.summary.averageMark = parseFloat((totalMarks / uniqueRecords.length).toFixed(2));
    result.summary.distinctionCount = uniqueRecords.filter(r => 
      r.grade && r.grade.includes('DISTINCTION')
    ).length;
    result.summary.failedCourses = uniqueRecords
      .filter(r => r.grade && (r.grade.includes('FAIL') || r.mark < 50))
      .map(r => r.course);
    result.summary.totalCredits = uniqueRecords.reduce((sum, r) => sum + (r.credits || 0), 0);
  }

  return result;
}

// Routes
router.get('/', (req, res) => {
  res.json({ 
    message: 'Transcript Parser API',
    endpoints: {
      analyze: 'POST /analyze-transcript',
      debug: 'POST /debug-pdf'
    }
  });
});

router.post('/analyze-transcript', upload.single('transcript'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    console.log('File uploaded:', req.file.filename);
    
    // Read and parse PDF
    const pdfBuffer = fs.readFileSync(req.file.path);
    const data = await pdf(pdfBuffer);
    const pdfText = data.text;
    
    console.log('PDF text extracted, length:', pdfText.length);
    
    // Parse transcript using custom parser
    const analysisResult = parseTranscript(pdfText);
    
    // Clean up uploaded file
    fs.unlinkSync(req.file.path);
    
    res.json(analysisResult);
  } catch (error) {
    console.error('Error analyzing transcript:', error);
    
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    
    res.status(500).json({ 
      error: 'Analysis failed',
      details: error.message
    });
  }
});

// Debug endpoint to see raw PDF text
router.post('/debug-pdf', upload.single('transcript'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const pdfBuffer = fs.readFileSync(req.file.path);
    const data = await pdf(pdfBuffer);
    
    // Clean up
    fs.unlinkSync(req.file.path);
    
    res.json({
      text: data.text,
      lines: data.text.split('\n').map(line => line.trim()).filter(line => line.length > 0)
    });
  } catch (error) {
    console.error('Debug error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;