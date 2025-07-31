const bcrypt = require('bcrypt');
const saltRounds = 10;
const newPassword = 'newpassword123';

bcrypt.hash(newPassword, saltRounds, (err, hash) => {
    if (err) {
        console.error('Error generating hash:', err);
        return;
    }
    console.log('New password hash:', hash);
});