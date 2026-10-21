import dotenv from 'dotenv';
dotenv.config();

// Default encryption key for test environment if not present
if (!process.env.ENCRYPTION_KEY) {
  process.env.ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
}
