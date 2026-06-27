import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    fullname: {
      type: String,
      required: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
    },
    phoneNumber: {
      type: String,
      required: false, // Changed to false for Google OAuth
      unique: true,
      sparse: true,    // CRITICAL: Prevents duplicate null/undefined index crashes
    },
    password: {
      type: String,
      required: false, // Kept false for Google OAuth
    },
    pancard: {
      type: String,
      required: false, // Changed to false for Google OAuth
      unique: true,
      sparse: true,    // CRITICAL
    },
    adharcard: {
      type: String,
      required: false, // Changed to false for Google OAuth
      unique: true,
      sparse: true,    // CRITICAL
    },
    role: {
      type: String,
      enum: ["Student", "Recruiter"],
      default: "Student",
      required: true,
    },
    profile: {
      bio: {
        type: String,
      },
      skills: [{ type: String }],
      resume: {
        type: String, // URL to resume file
      },
      resumeOriginalname: {
        type: String, // Original name of resume file
      },
      company: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Company",
      },
      profilePhoto: {
        type: String, // URL to profile photo file
        default: "",
      },
    },
    embeddings: {
      type: [Number], 
      default: []
    },
  },
  { timestamps: true }
);

export const User = mongoose.model("User", userSchema);