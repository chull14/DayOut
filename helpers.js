import { ObjectId } from 'mongodb';
import emailValidator from 'email-validator';

export function checkString(value) {
  if (value === undefined || value === null) {
    throw 'Value is required';
  }
  if (typeof value !== 'string') {
    throw 'Must be a string';
  }
  value = value.trim();
  if (value.length === 0) {
    throw 'Cannot be empty';
  }
  return value;
}

export function checkName(value) {
  value = checkString(value);

  if (value.length < 2 || value.length > 20) {
    throw 'Must be between 2 and 20 characters';
  }

  // Allow letters (including accented), plus spaces, hyphens and apostrophes,
  // so real names like O'Brien, Anne-Marie and José validate. Must start with
  // a letter to reject inputs that are only punctuation.
  const nameRegex = /^\p{L}[\p{L} '-]*$/u;
  if (!nameRegex.test(value)) {
    throw 'Must contain only letters, spaces, hyphens, and apostrophes';
  }

  return value;
}

export function checkPassword(value) {
  if (value === undefined || value === null) {
    throw 'Password is required';
  }
  if (typeof value !== 'string') {
    throw 'Password must be a string';
  }
  if (value.trim().length === 0) {
    throw 'Password is required';
  }
  if (value.length < 8) {
    throw 'Password must be at least 8 characters';
  }
  if (!/[A-Z]/.test(value)) {
    throw 'Password must contain at least one uppercase letter';
  }
  if (!/[a-z]/.test(value)) {
    throw 'Password must contain at least one lowercase letter';
  }
  if (!/[0-9]/.test(value)) {
    throw 'Password must contain at least one number';
  }
  if (!/[!@#$%^&*]/.test(value)) {
    throw 'Password must contain at least one special character (!@#$%^&*)';
  }
  if (/\s/.test(value)) {
    throw 'Password cannot contain spaces';
  }
  return value;
}

export function checkEmail(value) {
  value = checkString(value);
  value = value.toLowerCase();
  if (!emailValidator.validate(value)) {
    throw 'Not a valid email';
  }
  return value;
}

export function checkId(value) {
  value = checkString(value);
  if (!ObjectId.isValid(value)) {
    throw 'Not a valid ID';
  }
  return value;
}

export function checkRating(value) {
  if (value === undefined || value === null) {
    throw 'Rating is required';
  }
  value = Number(value);
  if (isNaN(value)) {
    throw 'Rating must be a number';
  }
  if (!Number.isInteger(value)) {
    throw 'Rating must be a whole number';
  }
  if (value < 1 || value > 5) {
    throw 'Rating must be between 1 and 5';
  }
  return value;
}

export function checkDate(value) {
  value = checkString(value);
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(value)) {
    throw 'Date must be in YYYY-MM-DD format';
  }
  if (isNaN(new Date(value).getTime())) {
    throw 'Not a valid date';
  }
  return value;
}

export function checkTime(time) {
  if (!time) throw "Error: time is required"
  if (typeof time !== 'string') throw "Error: time must be a string"

  time = time.trim().toUpperCase()

  const timeRegex = /^(0?[1-9]|1[0-2]):[0-5]\d\s?(AM|PM)$/
  if (!timeRegex.test(time)) throw "Error: time must be in HH:MM AM/PM format"

  return time
}