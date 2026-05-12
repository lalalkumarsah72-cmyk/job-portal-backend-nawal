// controllers/job.controller.js
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pdf = require('pdf-parse');
import { Job } from "../models/job.model.js";
import sanitizeHTML from "../utils/sanitizeHTML.js";
import axios from "axios";
import { User } from "../models/user.model.js";
import { generateFreeEmbeddings } from "../utils/vectorizer.js";

// Helper function to extract text from Cloudinary PDF
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

/* -------------------------------------------------
   USER – get recommended jobs based on Profile & Resume
------------------------------------------------- */
export const getRecommendedJobs = async (req, res) => {
  try {
    const userId = req.id;
    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({ message: "User not found", success: false });
    }

    // 1. CHECK/GENERATE USER EMBEDDINGS (THE "AUTOMATIC" PART)
    let userVector = user.embeddings;

    if (!userVector || userVector.length === 0) {
      console.log(`Auto-generating embeddings for: ${user.fullname}`);

      let resumeText = "";
      if (user.profile?.resume) {
        // Extracts text from the PDF URL
        resumeText = await extractTextFromPDF(user.profile.resume);
      }

      // Combine bio, skills, and resume text
      const bioData = `
                ${user.profile?.bio || ""} 
                ${user.profile?.skills?.join(" ") || ""} 
                ${resumeText}
            `.toLowerCase().trim();

      // Guard: If the user has a totally empty profile, stop here
      if (bioData.length < 10) {
        return res.status(200).json({
          success: true,
          recommendations: [],
          message: "Update your profile or upload a resume to see matches!"
        });
      }

      // Generate the 384-dimension vector (Transformers.js)
      userVector = await generateFreeEmbeddings(bioData);

      if (userVector) {
        user.embeddings = userVector;
        await user.save(); // Save to DB so we don't do this again next time
      }
    }

    // 2. VECTOR SEARCH VIA MONGODB ATLAS
    const recommendations = await Job.aggregate([
      {
        $vectorSearch: {
          index: "vector_index", // Must match your Atlas Index Name
          path: "embeddings",
          queryVector: userVector,
          numCandidates: 100,
          limit: 6
        }
      },
      {
        $lookup: {
          from: "companies",
          localField: "company",
          foreignField: "_id",
          as: "companyInfo"
        }
      },
      {
        $addFields: {
          company: { $ifNull: [{ $arrayElemAt: ["$companyInfo.name", 0] }, "External Company"] },
          companyLogo: { $arrayElemAt: ["$companyInfo.logo", 0] },
          // Convert score to percentage (e.g., 0.95 -> 95)
          matchScore: {
            $round: [{ $multiply: [{ $meta: "vectorSearchScore" }, 100] }, 0]
          }
        }
      },
      {
        $project: {
          companyInfo: 0,
          embeddings: 0,
          created_by: 0
        }
      }
    ]);

    return res.status(200).json({
      success: true,
      recommendations
    });

  } catch (error) {
    console.error("Vector Search Error:", error);
    return res.status(500).json({ message: "Recommendation engine error", success: false });
  }
};
/* -------------------------------------------------
   ADMIN – post a job
------------------------------------------------- */
export const postJob = async (req, res) => {
  try {
    const {
      title,
      description,
      requirements,
      salary,
      location,
      jobType,
      experience,
      position,
      companyId,
      applicationLink,
      companyLogo, // Optional
    } = req.body;
    const userId = req.id;

    if (
      !title ||
      !description ||
      !requirements ||
      !salary ||
      !location ||
      !jobType ||
      !experience ||
      !position ||
      !companyId
    ) {
      return res
        .status(400)
        .json({ message: "All fields are required", success: false });
    }
    const combinedText = `${title} ${description} ${requirements}`.toLowerCase();
    const vector = await generateFreeEmbeddings(combinedText);
    const job = await Job.create({
      title,
      description: sanitizeHTML(description),
      requirements: requirements.split(","),
      salary: Number(salary),
      location,
      jobType,
      experienceLevel: experience,
      position,
      company: companyId,
      created_by: userId,
      applicationLink: applicationLink || null,
      companyLogo: companyLogo || null,
      embeddings: vector || [] // Store the generated embedding vector
    });

    return res.status(201).json({
      message: "Job posted successfully.",
      job,
      status: true,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Server Error", status: false });
  }
};

/* -------------------------------------------------
   USER – get all jobs (internal + external API jobs)
------------------------------------------------- */
export const getAllJobs = async (req, res) => {
  try {
    const keyword = req.query.keyword ? String(req.query.keyword).trim() : "";
    const page = parseInt(req.query.page) || 1;
    const limit = 6;
    const skip = (page - 1) * limit;

    let query = {};

    if (keyword !== "") {
      const searchTerms = keyword.split(/\s+/).filter(term => term.length > 0);

      if (searchTerms.length > 0) {
        query.$and = searchTerms.map(term => {
          // Check if the term is a number or range (e.g., "50", "0-3")
          const isNumeric = /\d/.test(term);

          const orConditions = [
            { title: { $regex: new RegExp(`\\b${term}\\b`, 'i') } },
            { location: { $regex: new RegExp(`\\b${term}\\b`, 'i') } },
            { description: { $regex: new RegExp(`\\b${term}\\b`, 'i') } },
            { jobType: { $regex: new RegExp(`\\b${term}\\b`, 'i') } }
          ];

          // If the filter looks like a number, add numeric checks
          if (isNumeric) {
            // Extract the first number found (e.g., "50k" -> 50, "0-3" -> 0)
            const num = parseInt(term.match(/\d+/)[0]);

            orConditions.push(
              { experienceLevel: { $lte: num + 2, $gte: num - 2 } }, // Range check for experience
              { salary: { $gte: num * 1000 - 20000, $lte: num * 1000 + 20000 } } // Rough salary check
            );
          }

          return { $or: orConditions };
        });
      }
    }

    const totalJobs = await Job.countDocuments(query);
    const jobs = await Job.find(query)
      .populate("company")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const formattedJobs = (jobs || []).map((job) => {
      let companyName = "External Company";
      const match = job.description?.match(/<strong>Company:<\/strong>\s*([^<]+)<\/p>/i);
      if (match) {
        companyName = match[1].trim();
      } else if (job.company?.name) {
        companyName = job.company.name;
      }

      return {
        _id: job._id,
        title: job.title,
        description: sanitizeHTML(job.description),
        location: job.location,
        jobType: job.jobType,
        salary: job.salary,
        company: companyName,
        companyLogo: job.companyLogo || null,
        applicationLink: job.applicationLink || null,
        createdAt: job.createdAt,
        isExternal: !!job.applicationLink,
        experienceLevel: job.experienceLevel // Include it in response
      };
    });

    return res.status(200).json({
      status: true,
      jobs: formattedJobs,
      totalPages: Math.ceil(totalJobs / limit) || 1,
      currentPage: page
    });

  } catch (error) {
    return res.status(500).json({ status: false, message: "Server Error" });
  }
};
/* -------------------------------------------------
   USER – get a single job by id
------------------------------------------------- */
export const getJobById = async (req, res) => {
  try {
    const jobId = req.params.id;
    const job = await Job.findById(jobId)
      .populate("applications")
      .populate("company");

    if (!job) {
      return res
        .status(404)
        .json({ message: "Job not found", status: false });
    }

    // Extract company name from description
    let companyName = job.company?.name || "External Company";
    const match = job.description?.match(/<strong>Company:<\/strong>\s*([^<]+)<\/p>/i);
    if (match) {
      companyName = match[1].trim();
    }

    const safeJob = {
      ...job.toObject(),
      description: sanitizeHTML(job.description),
      companyLogo: job.companyLogo || null,
      company: companyName, // ← Add company name
    };

    return res.status(200).json({ job: safeJob, status: true });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Server Error", status: false });
  }
};

/* -------------------------------------------------
   ADMIN – jobs created by the logged-in admin
------------------------------------------------- */
export const getAdminJobs = async (req, res) => {
  try {
    const adminId = req.id;

    const jobs = await Job.find({ created_by: adminId }).populate("company");

    if (!jobs || jobs.length === 0) {
      return res
        .status(404)
        .json({ message: "No jobs found", status: false });
    }

    const formatted = jobs.map((job) => {
      return {
        ...job.toObject(),
        description: sanitizeHTML(job.description),
        companyName: job.company?.name || "Unknown Company", // ✅ Only name
        company: job.company || null, // ✅ Full company object
        companyLogo: job.companyLogo || job.company?.logo || null,
      };
    });

    return res.status(200).json({ jobs: formatted, status: true });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Server Error", status: false });
  }
};
