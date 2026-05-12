// cron/jobScheduler.js
import cron from "node-cron";
import { fetchAdzunaJobs, fetchJoobleJobs } from "../services/jobFetcher.js";
import { runEmbeddingMigration } from "../services/vectorWorker.js";

const runJobFetch = async () => {
    console.log("--- [Manual Run] Fetching latest jobs ---");
    try {
        await fetchAdzunaJobs();
        await fetchJoobleJobs();
        console.log("--- [Manual Run] Job fetching completed ---");
    } catch (err) {
        console.error("--- [Manual Run] Error fetching jobs:", err.message);
    }
};

const runVectorMigration = async () => {
    console.log("--- [Manual Run] Starting Vector Migration ---");
    try {
        await runEmbeddingMigration();
        console.log("--- [Manual Run] Vector Migration completed ---");
    } catch (err) {
        console.error("--- [Manual Run] Error in Vector Migration:", err.message);
    }
};

// Initialization Block (Runs when server starts)
(async () => {
    // We do NOT call connectDB() here because index.js handles it.

    // 1. Schedule Job Fetcher: Every 6 hours at minute 0
    cron.schedule("0 */6 * * *", runJobFetch);

    // 2. Schedule Vectorizer: Every 6 hours at minute 30
    cron.schedule("30 */6 * * *", runVectorMigration);

    // 3. Initial Execution: Run both once immediately on server start
    // We use a small delay for the vectorizer so the fetcher can finish first
    await runJobFetch();
    setTimeout(async () => {
        await runVectorMigration();
    }, 1000 * 60 * 5); // Run vectorizer 5 minutes after server start
})();

console.log("🔔 Automation Schedulers Initialized (Staggered 30m)");