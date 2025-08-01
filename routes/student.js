const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const db = require('../database/connection');
const { requireLogin, requireStudent } = require('../middleware/authMiddleware');

const saltRounds = 10;

// GET /student/profile - View student profile
router.get('/profile', requireLogin, requireStudent, (req, res) => {
    const studentId = req.session.userId;

    // Fetch core student info
    const studentSql = `
        SELECT id, student_number, name, email, created_at
        FROM students
        WHERE id = ?
    `;
    db.get(studentSql, [studentId], (err, student) => {
        if (err) {
            console.error('DB Error fetching student profile:', err.message);
            return res.status(500).render('error', { message: 'Error fetching profile.' });
        }
        if (!student) {
            console.error('Student not found for ID:', studentId);
            return res.status(404).render('error', { message: 'Student profile not found.' });
        }

        // Fetch latest application details for additional profile info
        const appSql = `
            SELECT title, initials, identity_number, appointment_from, appointment_to,
                   postal_address, postal_code, residential_address, residential_code,
                   cellular_phone, bank_name, branch_code, account_number, account_holder_name,
                   income_tax_number, submission_date
            FROM applications
            WHERE student_id = ?
            ORDER BY application_date DESC
            LIMIT 1
        `;
        db.get(appSql, [studentId], (appErr, appDetails) => {
            if (appErr) {
                console.error('DB Error fetching application details:', appErr.message);
                // Continue rendering without app details
                appDetails = {};
            }

            // Fetch application summary (e.g., count and recent statuses)
            const appSummarySql = `
                SELECT status, COUNT(*) as count
                FROM applications
                WHERE student_id = ?
                GROUP BY status
            `;
            db.all(appSummarySql, [studentId], (summaryErr, appSummary) => {
                if (summaryErr) {
                    console.error('DB Error fetching application summary:', summaryErr.message);
                    appSummary = [];
                }

                res.render('student/profile', {
                    student,
                    appDetails: appDetails || {},
                    appSummary,
                    error: req.flash ? req.flash('error') : null,
                    message: req.flash ? req.flash('success') : null
                });
            });
        });
    });
});

// GET /student/profile/edit - Render edit profile form
router.get('/profile/edit', requireLogin, requireStudent, (req, res) => {
    const studentId = req.session.userId;

    const sql = `
        SELECT id, student_number, name, email
        FROM students
        WHERE id = ?
    `;
    db.get(sql, [studentId], (err, student) => {
        if (err) {
            console.error('DB Error fetching student for edit:', err.message);
            return res.status(500).render('error', { message: 'Error loading edit form.' });
        }
        if (!student) {
            return res.status(404).render('error', { message: 'Student profile not found.' });
        }

        // Fetch latest application details for pre-filling optional fields
        const appSql = `
            SELECT title, initials, identity_number, cellular_phone, postal_address,
                   postal_code, residential_address, residential_code
            FROM applications
            WHERE student_id = ?
            ORDER BY application_date DESC
            LIMIT 1
        `;
        db.get(appSql, [studentId], (appErr, appDetails) => {
            if (appErr) {
                console.error('DB Error fetching application details for edit:', appErr.message);
                appDetails = {};
            }

            res.render('student/edit_profile', {
                student,
                appDetails: appDetails || {},
                error: req.flash ? req.flash('error') : null,
                message: req.flash ? req.flash('success') : null
            });
        });
    });
});

// POST /student/profile/edit - Update profile details
router.post('/profile/edit', requireLogin, requireStudent, (req, res) => {
    const studentId = req.session.userId;
    const { name, email, password, confirmPassword, title, initials, identity_number,
            cellular_phone, postal_address, postal_code, residential_address, residential_code } = req.body;

    // Validate required fields
    if (!name || !email) {
        req.flash('error', 'Name and email are required.');
        return res.redirect('/student/profile/edit');
    }

    // Validate password if provided
    let passwordUpdate = {};
    if (password || confirmPassword) {
        if (password !== confirmPassword) {
            req.flash('error', 'Passwords do not match.');
            return res.redirect('/student/profile/edit');
        }
        if (password.length < 8) {
            req.flash('error', 'Password must be at least 8 characters long.');
            return res.redirect('/student/profile/edit');
        }
        passwordUpdate = bcrypt.hashSync(password, saltRounds);
    }

    // Update students table
    const updateStudentSql = `
        UPDATE students
        SET name = ?, email = ?
        WHERE id = ?
    `;
    db.run(updateStudentSql, [name, email, studentId], function (err) {
        if (err) {
            console.error('DB Error updating student profile:', err.message);
            if (err.message.includes('UNIQUE')) {
                req.flash('error', 'Email is already in use.');
            } else {
                req.flash('error', 'Error updating profile.');
            }
            return res.redirect('/student/profile/edit');
        }

        // If password was updated, update it separately
        if (passwordUpdate) {
            db.run(`UPDATE students SET password_hash = ? WHERE id = ?`, [passwordUpdate, studentId], (passErr) => {
                if (passErr) {
                    console.error('DB Error updating password:', passErr.message);
                    req.flash('error', 'Error updating password.');
                    return res.redirect('/student/profile/edit');
                }
                updateAppDetails();
            });
        } else {
            updateAppDetails();
        }

        // Update or insert application details (store in applications table for consistency)
        function updateAppDetails() {
            // Check if student has an existing application to update
            const checkAppSql = `SELECT id FROM applications WHERE student_id = ? LIMIT 1`;
            db.get(checkAppSql, [studentId], (checkErr, existingApp) => {
                if (checkErr) {
                    console.error('DB Error checking existing application:', checkErr.message);
                    req.flash('error', 'Error updating profile details.');
                    return res.redirect('/student/profile/edit');
                }

                // Optional fields: only include if provided
                const appFields = {
                    title, initials, identity_number, cellular_phone,
                    postal_address, postal_code, residential_address, residential_code
                };
                const hasAppData = Object.values(appFields).some(val => val);

                if (!hasAppData && !existingApp) {
                    // No application data to update and no existing application
                    req.flash('success', 'Profile updated successfully.');
                    return res.redirect('/student/profile');
                }

                if (existingApp) {
                    // Update latest application (simplest approach)
                    const updateAppSql = `
                        UPDATE applications
                        SET title = ?, initials = ?, identity_number = ?, cellular_phone = ?,
                            postal_address = ?, postal_code = ?, residential_address = ?, residential_code = ?
                        WHERE id = ?
                    `;
                    db.run(updateAppSql, [
                        title || null, initials || null, identity_number || null, cellular_phone || null,
                        postal_address || null, postal_code || null, residential_address || null, residential_code || null,
                        existingApp.id
                    ], (appErr) => {
                        if (appErr) {
                            console.error('DB Error updating application details:', appErr.message);
                            req.flash('error', 'Error updating profile details.');
                            return res.redirect('/student/profile/edit');
                        }
                        req.flash('success', 'Profile updated successfully.');
                        res.redirect('/student/profile');
                    });
                } else {
                    // Insert a dummy application record to store profile details
                    const insertAppSql = `
                        INSERT INTO applications (
                            job_post_id, student_id, status, title, initials, identity_number,
                            cellular_phone, postal_address, postal_code, residential_address, residential_code
                        ) VALUES (?, ?, 'Profile', ?, ?, ?, ?, ?, ?, ?, ?)
                    `;
                    db.run(insertAppSql, [
                        0, studentId, // job_post_id = 0 for profile-only record
                        title || null, initials || null, identity_number || null, cellular_phone || null,
                        postal_address || null, postal_code || null, residential_address || null, residential_code || null
                    ], (insertErr) => {
                        if (insertErr) {
                            console.error('DB Error inserting profile details:', insertErr.message);
                            req.flash('error', 'Error updating profile details.');
                            return res.redirect('/student/profile/edit');
                        }
                        req.flash('success', 'Profile updated successfully.');
                        res.redirect('/student/profile');
                    });
                }
            });
        }
    });
});

module.exports = router;