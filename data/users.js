import { users } from '../config/mongoCollections.js';
import { checkName, checkPassword, checkString, checkId, checkEmail } from '../helpers.js';
import { ObjectId } from 'mongodb';
import bcrypt from 'bcryptjs';

export async function createUser(firstName, lastName, email, password) {    
    if (firstName === undefined) throw 'Must have a first name';
    if (lastName === undefined) throw 'Must have a last name';
    if (email === undefined) throw 'Must have an email';
    if (password === undefined) throw 'Must have a password';
    
    firstName = checkName(firstName);
    lastName = checkName(lastName);
    password = checkPassword(password);
    email = checkEmail(email);
    
    const userCollection = await users();
    const existingEmail = await userCollection.findOne({ email: email });
    
    if (existingEmail !== null) {
        throw 'That email is already being used';
    }
    
    const hashedPassword = await bcrypt.hash(password, 10);
    
    const newUser = {
        firstName: firstName,
        lastName: lastName,
        email: email,
        hashedPassword: hashedPassword,
        role: 'user',
        favoriteLocations: [],
        friends: [],
        pendingRequests: [],
        createdAt: new Date()
    };
    
    const result = await userCollection.insertOne(newUser);
    
    if (!result.acknowledged) {
        throw 'Could not create user';
    }
    
    return { signupCompleted: true };
}

export async function loginUser(email, password) {
    if (email === undefined) throw 'Must have an email';
    if (password === undefined) throw 'Must have a password';
    
    email = checkEmail(email);
    
    password = checkString(password);
    
    const userCollection = await users();
    const user = await userCollection.findOne({ email: email });
    
    if (user === null) {
        throw 'Invalid email or password';
    }
    
    const match = await bcrypt.compare(password, user.hashedPassword);
    
    if (!match) {
        throw 'Invalid email or password';
    }
    
    return {
        _id: user._id.toString(),
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        role: user.role
    };
}

export async function getUserById(id) {
    if (id === undefined) throw 'Must have an id';
    
    id = checkId(id);
    
    const userCollection = await users();
    const user = await userCollection.findOne({ _id: new ObjectId(id) });
    
    if (user === null) {
        throw 'No user found with that id';
    }
    
    user._id = user._id.toString();
    
    return user;
}
