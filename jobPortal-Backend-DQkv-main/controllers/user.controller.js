import { User } from "../models/user.model.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import getDataUri from "../utils/datauri.js";
import cloudinary from "../utils/cloud.js";
import axios from "axios";
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pdf = require('pdf-parse');

// IMPORT your vectorizer
import { generateFreeEmbeddings } from "../utils/vectorizer.js";

// HELPER: Needs to be inside this file (or imported) to work
const extractTextFromPDF = async (url) => {
  try {
    const response = await axios.get(url, { responseType: 'arraybuffer' });
    const data = await pdf(response.data);
    return data.text.toLowerCase();
  } catch (error) {
    console.error("PDF Parsing Error:", error);
    return "";
  }
};

export const register = async (req, res) => {
  console.log("=== REGISTER ENDPOINT HIT ===");
  console.log("Body received:", req.body);
  console.log("File received:", req.file ? req.file.originalname : "NO FILE");

  try {
    const { fullname, email, phoneNumber, password, adharcard, pancard, role } = req.body || {};

    if (!fullname || !email || !phoneNumber || !password || !role || !adharcard || !pancard) {
      return res.status(400).json({
        message: "All fields are required",
        success: false,
      });
    }

    // Check duplicates
    const existingUser = await User.findOne({ email });
    if (existingUser) return res.status(400).json({ message: "Email already exists", success: false });

    const existingAdhar = await User.findOne({ adharcard });
    if (existingAdhar) return res.status(400).json({ message: "Aadhaar already exists", success: false });

    const existingPan = await User.findOne({ pancard });
    if (existingPan) return res.status(400).json({ message: "PAN already exists", success: false });

    // File upload — optional
    let profilePhotoUrl = null;
    if (req.file) {
      console.log("Uploading file to Cloudinary...");
      try {
        const fileUri = getDataUri(req.file);
        const cloudResponse = await cloudinary.uploader.upload(fileUri.content);
        profilePhotoUrl = cloudResponse.secure_url;
        console.log("Cloudinary success:", profilePhotoUrl);
      } catch (cloudErr) {
        console.error("Cloudinary FAILED:", cloudErr.message);
        // Continue without photo
      }
    } else {
      console.log("No profile photo uploaded");
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const newUser = await User.create({
      fullname,
      email,
      phoneNumber,
      adharcard,
      pancard,
      password: hashedPassword,
      role,
      profile: {
        profilePhoto: profilePhotoUrl,
      },
    });

    console.log("User created:", newUser.email);

    return res.status(201).json({
      message: `Account created successfully for ${fullname}`,
      success: true,
    });
  } catch (error) {
    console.error("REGISTER CRASH:", error.message, error.stack);
    return res.status(500).json({
      message: "Server error during registration",
      error: error.message,
      success: false,
    });
  }
};

export const login = async (req, res) => {
  try {
    const { email, password, role } = req.body;

    if (!email || !password || !role) {
      return res.status(400).json({ message: "Missing required fields", success: false });
    }

    const user = await User.findOne({ email });
    if (!user) return res.status(401).json({ message: "Invalid credentials", success: false });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(401).json({ message: "Invalid credentials", success: false });

    if (user.role !== role) return res.status(403).json({ message: "Invalid role", success: false });

    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: "1d" });

    const sanitizedUser = {
      _id: user._id,
      fullname: user.fullname,
      email: user.email,
      phoneNumber: user.phoneNumber,
      role: user.role,
      profile: user.profile,
    };

    console.log("Setting cookie for user:", user.email);

    res.cookie("token", token, {
      httpOnly: true,
      secure: true,                // false for HTTP (EC2)
      sameSite: "None",
      partitioned: true,// works on HTTP
      maxAge: 24 * 60 * 60 * 1000,
      path: "/",
    });

    return res.status(200).json({
      message: `Welcome back ${user.fullname}`,
      user: sanitizedUser,
      success: true,
    });
  } catch (error) {
    console.error("LOGIN CRASH:", error.message, error.stack);
    res.status(500).json({ message: "Server Error login failed", success: false });
  }
};

export const logout = async (req, res) => {
  try {
    res.clearCookie("token", {
      httpOnly: true,
      secure: true,
      sameSite: "None",
      partitioned: true,
      path: "/",
    });

    return res.status(200).json({
      message: "Logged out successfully",
      success: true,
    });
  } catch (error) {
    console.error("LOGOUT ERROR:", error);
    res.status(500).json({ message: "Server Error logging out", success: false });
  }
};
export const updateProfile = async (req, res) => {
  try {
    const userId = req.id;
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: "User not found", success: false });

    const { fullname, email, phoneNumber, bio, skills } = req.body || {};

    if (fullname) user.fullname = fullname;
    if (email) user.email = email;
    if (phoneNumber) user.phoneNumber = phoneNumber;
    if (bio) user.profile.bio = bio;

    let skillsArray = user.profile.skills || [];
    if (skills) {
      skillsArray = skills.split(",");
      user.profile.skills = skillsArray;
    }

    let currentResumeText = "";
    if (req.file) {
      const fileUri = getDataUri(req.file);
      const cloudResponse = await cloudinary.uploader.upload(fileUri.content, {
        resource_type: "auto",
        folder: "resumes",
      });

      user.profile.resume = cloudResponse.secure_url;
      user.profile.resumeOriginalName = req.file.originalname;

      currentResumeText = await extractTextFromPDF(cloudResponse.secure_url);
    } else if (user.profile.resume) {
      currentResumeText = await extractTextFromPDF(user.profile.resume);
    }

    // Embeddings Generation
    const textToEmbed = `
      ${user.profile.bio || ""} 
      ${skillsArray.join(" ")} 
      ${currentResumeText}
    `.toLowerCase().trim();

    if (textToEmbed.length > 10) {
      // Logic check: only update if generateFreeEmbeddings exists
      const newVector = await generateFreeEmbeddings(textToEmbed);
      if (newVector) {
        user.embeddings = newVector;
      }
    }

    await user.save();

    const updatedUser = {
      _id: user._id,
      fullname: user.fullname,
      email: user.email,
      phoneNumber: user.phoneNumber,
      role: user.role,
      profile: user.profile,
    };

    return res.status(200).json({
      message: "Profile updated successfully",
      user: updatedUser,
      success: true,
    });
  } catch (error) {
    console.error("PROFILE UPDATE ERROR:", error);
    res.status(500).json({ message: "Server Error updating profile", success: false });
  }
};