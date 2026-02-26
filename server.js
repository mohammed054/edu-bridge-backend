require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { connectDB } = require("./db");

const authRoutes = require("./routes/authRoutes");
const adminRoutes = require("./routes/adminRoutes");
const feedbackRoutes = require("./routes/feedbackRoutes");
const profileRoutes = require("./routes/profileRoutes");
const teacherRoutes = require("./routes/teacherRoutes");
const surveyRoutes = require("./routes/surveyRoutes");

const app = express();

/* ===========================
   ENV VALIDATION
=========================== */

if (!process.env.MONGO_URI) {
  throw new Error("MONGO_URI is required in .env");
}

if (!process.env.JWT_SECRET) {
  throw new Error("JWT_SECRET is required in .env");
}

/* ===========================
   CORS CONFIG (DEV + SAFE)
=========================== */

app.use(
  cors({
    origin: function (origin, callback) {
      // Allow requests without origin (Postman, curl, etc.)
      if (!origin) return callback(null, true);

      // Allow any localhost or 127.0.0.1 with any port
      if (
        origin.startsWith("http://localhost:") ||
        origin.startsWith("http://127.0.0.1:")
      ) {
        return callback(null, true);
      }

      console.log("❌ Blocked by CORS:", origin);
      return callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// Handle preflight requests explicitly
app.options("*", cors());

/* ===========================
   MIDDLEWARE
=========================== */

app.use(express.json());

/* ===========================
   HEALTH CHECK
=========================== */

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

/* ===========================
   ROUTES
=========================== */

app.use("/api/auth", authRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/feedback", feedbackRoutes);
app.use("/api/profile", profileRoutes);
app.use("/api/teacher", teacherRoutes);
app.use("/api/surveys", surveyRoutes);

/* ===========================
   404 HANDLER
=========================== */

app.use("/api/*", (req, res) => {
  res.status(404).json({
    message: `Route not found: ${req.originalUrl}`,
  });
});

/* ===========================
   GLOBAL ERROR HANDLER
=========================== */

app.use((err, _req, res, _next) => {
  console.error("🔥 Server Error:", err.message);
  res.status(500).json({
    message: err.message || "Something went wrong.",
  });
});

/* ===========================
   SERVER START
=========================== */

const PORT = process.env.PORT || 5000;

connectDB()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error("❌ Database connection failed:", err.message);
    process.exit(1);
  });

module.exports = app;
