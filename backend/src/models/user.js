import mongoose from 'mongoose';

const userSchema = new mongoose.Schema(
  {
    firstName: { type: String, required: true },
    lastName: { type: String, required: true },
    designation: { type: String, required: true },
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true },

    // existing optional fields
    githubId: { type: String, default: null },
    accessToken: { type: String, default: null },

    // NEW: GitHub config (secrets encrypted)
    github: {
      patEnc: { type: String, default: null },             // encrypted PAT
      clientId: { type: String, default: null },
      clientSecretEnc: { type: String, default: null },     // encrypted client secret
      callbackUrl: { type: String, default: null },
      homepageUrl: { type: String, default: null }
    }
  },
  { timestamps: true }
);

export default mongoose.model('User', userSchema);
