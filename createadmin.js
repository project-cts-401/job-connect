const bcrypt = require('bcrypt');
const db = require('./database/connection');

const saltRounds = 10;
const plainPassword = '@Project_01%'; // Change this to your desired password

bcrypt.hash(plainPassword, saltRounds, (err, hashedPassword) => {
    if (err) {
        console.error('Error hashing password:', err);
        return;
    }

    const insertSql = `
        INSERT INTO faculty_admins (name, email, staff_number, password_hash) 
        VALUES (?, ?, ?, ?)
    `;
    
    const params = [
        'System Administrator',
        'admin@ump.ac.za',
        'ADM001',
        hashedPassword
    ];

    db.run(insertSql, params, function(insertErr) {
        if (insertErr) {
            console.error('Error creating admin:', insertErr.message);
        } else {
            console.log('✅ New admin created successfully!');
            console.log('Email: admin@ump.ac.za');
            console.log('Staff Number: ADM001');
            console.log('Password: password123'); // Change this if you used a different password
        }
        
        db.close(); // Close the database connection
    });
});