import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { Job } from '../models/job.model.js';
import { generateFreeEmbeddings } from '../utils/vectorizer.js';

dotenv.config(); // This loads your MONGO_URI from the .env file

const runMigration = async () => {
    try {
        console.log("Connecting to Database...");
        await mongoose.connect(process.env.MONGO_URI);

        // Find jobs that don't have embeddings yet
        const jobsToUpdate = await Job.find({
            $or: [
                { embeddings: { $exists: false } },
                { embeddings: { $size: 0 } }
            ]
        });

        console.log(`Found ${jobsToUpdate.length} jobs needing vectors.`);

        for (const job of jobsToUpdate) {
            console.log(`Processing: ${job.title}...`);

            // Combine fields to create a rich text description for the AI
            const textToEmbed = `${job.title} ${job.description} ${job.requirements.join(" ")}`.toLowerCase();

            const vector = await generateFreeEmbeddings(textToEmbed);

            if (vector) {
                job.embeddings = vector;
                await job.save();
                console.log(`✅ Success!`);
            } else {
                console.log(`❌ Failed to generate vector for ${job.title}`);
            }
        }

        console.log("--- All jobs processed! ---");
        process.exit(0);
    } catch (error) {
        console.error("Migration Error:", error);
        process.exit(1);
    }
};

runMigration();