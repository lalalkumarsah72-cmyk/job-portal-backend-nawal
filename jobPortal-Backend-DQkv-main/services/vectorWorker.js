import { Job } from '../models/job.model.js';
import { generateFreeEmbeddings } from '../utils/vectorizer.js';

export const runEmbeddingMigration = async () => {
    try {
        // Find jobs missing embeddings
        const jobsToUpdate = await Job.find({
            $or: [
                { embeddings: { $exists: false } },
                { embeddings: { $size: 0 } },
                { embeddings: null }
            ]
        }).limit(20);

        if (jobsToUpdate.length === 0) return;

        console.log(`[VectorWorker] Processing batch of ${jobsToUpdate.length} jobs...`);

        for (const job of jobsToUpdate) {
            // Clean HTML tags: AI shouldn't "see" <div> or <p> tags
            const cleanDesc = job.description.replace(/<[^>]*>?/gm, '');
            const textToEmbed = `${job.title} ${cleanDesc} ${job.requirements?.join(" ") || ""}`.toLowerCase();

            const vector = await generateFreeEmbeddings(textToEmbed);

            if (vector) {
                job.embeddings = vector;
                await job.save();
                console.log(`✅ Vectorized: ${job.title}`);
            }
        }

    } catch (error) {
        console.error("[VectorWorker] Error:", error);
    }
};