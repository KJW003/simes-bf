-- Fix admin password hash
UPDATE users SET password_hash = '$2b$10$i3gIdausWED.7Qw96CVJ4OBF1.M.WiMk6EqrClYcyQ04VV3l6T4Yu'
WHERE email = 'admin@simes.bf';

-- Verify
SELECT email, password_hash FROM users WHERE email = 'admin@simes.bf';
