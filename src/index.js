import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import rateLimit from 'express-rate-limit';
import { fileURLToPath } from 'url';

import {
  initDB,
  getVoter,
  getAllVoters,
  getCategories,
  addCategory,
  updateCategory,
  deleteCategory,
  submitBallot,
  getElectionStatus,
  setElectionStatus,
  getResults,
  resetElection,
  getDatabaseMode,
  getSettings,
  updateSetting,
  addManualFaculty,
  invalidateVoterBallot,
  revokeVoterEligibility,
  getAuditLogs
} from './db.js';
import { syncGoogleSheetRoster } from './sync.js';
import { generateExcelReport } from './export.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PIN = process.env.ADMIN_PIN || 'admin';

if (!process.env.ADMIN_PIN) {
  console.warn('⚠️ SECURITY NOTICE: ADMIN_PIN environment variable is not set. Please set ADMIN_PIN in your .env or host settings.');
}

app.use(cors());
app.use(express.json());

// -------------------------------------------------------------
// Security Rate Limiters
// -------------------------------------------------------------
const voterVerifyLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30,
  message: { error: 'Too many verification attempts from this network. Please wait a minute and try again.' },
  standardHeaders: true,
  legacyHeaders: false
});

const adminAuthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  message: { error: 'Too many failed admin login attempts. Please try again after 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false
});

const voteSubmitLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10,
  message: { error: 'Too many vote submission requests. Please wait a moment.' },
  standardHeaders: true,
  legacyHeaders: false
});

// -------------------------------------------------------------
// Admin Auth Middleware
// -------------------------------------------------------------
function requireAdminAuth(req, res, next) {
  const pin = req.headers['x-admin-pin'] || req.query.admin_pin || req.body?.admin_pin;
  if (!pin || pin !== ADMIN_PIN) {
    return res.status(401).json({
      error: 'Invalid or missing Admin PIN. Access denied.'
    });
  }
  next();
}

// -------------------------------------------------------------
// Helper: Check Election Expiration
// -------------------------------------------------------------
async function checkElectionExpiration() {
  const settings = await getSettings();
  if (settings.voting_end_time && settings.voting_end_time.trim()) {
    const endTime = new Date(settings.voting_end_time).getTime();
    if (!isNaN(endTime) && Date.now() > endTime) {
      return true; // Expired
    }
  }
  return false;
}

// -------------------------------------------------------------
// Public / Voter API Endpoints
// -------------------------------------------------------------

// 1. General System Status
app.get('/api/status', async (req, res) => {
  try {
    const electionStatus = await getElectionStatus();
    const resultsData = await getResults();
    const settings = await getSettings();
    const isExpired = await checkElectionExpiration();

    res.json({
      election_status: isExpired ? 'CLOSED' : electionStatus,
      database_mode: getDatabaseMode(),
      turnout: resultsData.turnout,
      allow_self_voting: settings.allow_self_voting === '1' || settings.allow_self_voting === 'true',
      voting_end_time: settings.voting_end_time || '',
      is_expired: isExpired
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. Verify Faculty Voter by Staff ID
app.post('/api/voter/verify', voterVerifyLimiter, async (req, res) => {
  try {
    const { staff_id } = req.body;
    if (!staff_id || !String(staff_id).trim()) {
      return res.status(400).json({
        error: 'Please enter your Staff ID to proceed.'
      });
    }

    const isExpired = await checkElectionExpiration();
    if (isExpired) {
      return res.status(403).json({
        error: 'Voting for the ARMTI Faculty Awards has officially concluded (voting deadline reached).'
      });
    }

    const electionStatus = await getElectionStatus();
    if (electionStatus === 'DRAFT') {
      return res.status(403).json({
        error: 'Voting has not officially commenced. Please check back when voting opens.'
      });
    }
    if (electionStatus === 'PAUSED') {
      return res.status(403).json({
        error: 'Voting is temporarily paused by the election committee. Please try again shortly.'
      });
    }
    if (electionStatus === 'CLOSED') {
      return res.status(403).json({
        error: 'Voting for the ARMTI Faculty Awards is now officially closed. Thank you!'
      });
    }

    const voter = await getVoter(staff_id);

    if (!voter) {
      return res.status(404).json({
        error: `Staff ID '${staff_id.trim()}' is not recognized as an eligible ARMTI Faculty member. Please verify your Staff ID or contact the election committee.`
      });
    }

    if (voter.has_voted) {
      const formattedDate = voter.voted_at ? new Date(voter.voted_at).toLocaleString() : 'Earlier';
      return res.status(403).json({
        error: `This Staff ID has already cast a ballot on ${formattedDate}. Multiple voting is strictly prohibited.`,
        already_voted: true,
        receipt_code: voter.receipt_code,
        voted_at: voter.voted_at
      });
    }

    res.json({
      eligible: true,
      voter: {
        staff_id: voter.staff_id,
        full_name: voter.full_name,
        department: voter.department,
        division: voter.division,
        training_center: voter.training_center
      }
    });
  } catch (err) {
    res.status(500).json({ error: 'Server error during voter verification. ' + err.message });
  }
});

// 3. Get Active Categories for Ballot
app.get('/api/categories', async (req, res) => {
  try {
    const categories = await getCategories(false);
    res.json({ categories });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. Get Faculty Roster for Autocomplete Search
app.get('/api/voters/roster', async (req, res) => {
  try {
    const voters = await getAllVoters();
    const roster = voters.map((v) => ({
      staff_id: v.staff_id,
      full_name: v.full_name,
      department: v.department || 'ARMTI Faculty',
      division: v.division || '',
      training_center: v.training_center || ''
    }));
    res.json({ roster });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 5. Submit Ballot
app.post('/api/vote/submit', voteSubmitLimiter, async (req, res) => {
  try {
    const { staff_id, votes } = req.body;
    if (!staff_id || !votes || !Array.isArray(votes)) {
      return res.status(400).json({
        error: 'Invalid ballot payload. Please provide staff_id and votes array.'
      });
    }

    const isExpired = await checkElectionExpiration();
    if (isExpired) {
      return res.status(403).json({
        error: 'Voting deadline has passed. Ballot cannot be accepted.'
      });
    }

    const electionStatus = await getElectionStatus();
    if (electionStatus !== 'OPEN') {
      return res.status(403).json({
        error: `Voting is currently ${electionStatus.toLowerCase()}. Ballot cannot be accepted.`
      });
    }

    const result = await submitBallot(staff_id, votes);
    res.json({
      success: true,
      message: 'Ballot successfully cast and recorded.',
      receipt_code: result.receipt_code,
      voted_at: result.voted_at,
      full_name: result.full_name
    });
  } catch (err) {
    const statusCode = err.message.includes('already cast') ? 403 : 400;
    res.status(statusCode).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// Admin Protected Endpoints
// -------------------------------------------------------------

app.post('/api/admin/login', adminAuthLimiter, (req, res) => {
  const { pin } = req.body;
  if (pin === ADMIN_PIN) {
    return res.json({ success: true, message: 'Admin authenticated successfully.' });
  }
  return res.status(401).json({ error: 'Invalid Admin PIN. Access denied.' });
});

// Update Election Settings (allow_self_voting, voting_end_time)
app.post('/api/admin/settings', requireAdminAuth, async (req, res) => {
  try {
    const { allow_self_voting, voting_end_time } = req.body;
    if (allow_self_voting !== undefined) {
      await updateSetting('allow_self_voting', allow_self_voting ? '1' : '0');
    }
    if (voting_end_time !== undefined) {
      await updateSetting('voting_end_time', String(voting_end_time));
    }
    const updatedSettings = await getSettings();
    res.json({ success: true, settings: updatedSettings });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/categories', requireAdminAuth, async (req, res) => {
  try {
    const categories = await getCategories(true);
    res.json({ categories });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/categories', requireAdminAuth, async (req, res) => {
  try {
    const { title, description, sort_order } = req.body;
    if (!title || !title.trim()) {
      return res.status(400).json({ error: 'Category title is required.' });
    }
    const newCat = await addCategory({ title: title.trim(), description: description?.trim(), sort_order: sort_order || 99 });
    res.json({ success: true, category: newCat });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/admin/categories/:id', requireAdminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, sort_order, is_active } = req.body;
    await updateCategory(id, { title, description, sort_order, is_active });
    res.json({ success: true, message: 'Category updated successfully.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/admin/categories/:id', requireAdminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    await deleteCategory(id);
    res.json({ success: true, message: 'Category deleted successfully.' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/admin/sync-roster', requireAdminAuth, async (req, res) => {
  try {
    const { sheet_url } = req.body;
    const result = await syncGoogleSheetRoster(sheet_url);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Failed to sync Google Sheet: ' + err.message });
  }
});

app.post('/api/admin/election-status', requireAdminAuth, async (req, res) => {
  try {
    const { status } = req.body;
    const validStates = ['OPEN', 'PAUSED', 'CLOSED', 'DRAFT'];
    if (!validStates.includes(status)) {
      return res.status(400).json({ error: 'Invalid status. Must be OPEN, PAUSED, CLOSED, or DRAFT.' });
    }
    await setElectionStatus(status);
    res.json({ success: true, election_status: status });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/results', requireAdminAuth, async (req, res) => {
  try {
    const resultsData = await getResults();
    res.json(resultsData);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/export-results', requireAdminAuth, async (req, res) => {
  try {
    const buffer = await generateExcelReport();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="ARMTI_Faculty_Awards_Results.xlsx"');
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate Excel report: ' + err.message });
  }
});

app.get('/api/admin/voters', requireAdminAuth, async (req, res) => {
  try {
    const voters = await getAllVoters(true); // include ineligible
    res.json({ voters });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/voters/quick-add', requireAdminAuth, async (req, res) => {
  try {
    const { staff_id, full_name, department, division, training_center } = req.body;
    if (!staff_id || !full_name) {
      return res.status(400).json({ error: 'Staff ID and Full Name are required.' });
    }
    const voter = await addManualFaculty({ staff_id, full_name, department, division, training_center });
    res.json({ success: true, message: `Faculty member ${voter.full_name} (${voter.staff_id}) added successfully.`, voter });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/admin/voters/:staffId/invalidate', requireAdminAuth, async (req, res) => {
  try {
    const { staffId } = req.params;
    const { reason } = req.body || {};
    const result = await invalidateVoterBallot(staffId, reason);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/admin/voters/:staffId/revoke', requireAdminAuth, async (req, res) => {
  try {
    const { staffId } = req.params;
    const { reason } = req.body || {};
    const result = await revokeVoterEligibility(staffId, reason);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/admin/audit-logs', requireAdminAuth, async (req, res) => {
  try {
    const logs = await getAuditLogs();
    res.json({ logs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/reset-election', requireAdminAuth, async (req, res) => {
  try {
    await resetElection();
    res.json({ success: true, message: 'All ballots have been cleared and voter statuses reset.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Serve frontend dist if built
const frontendDist = path.join(__dirname, '../../frontend/dist');
if (fs.existsSync(path.join(frontendDist, 'index.html'))) {
  app.use(express.static(frontendDist));
  app.get('*', (req, res) => {
    res.sendFile(path.join(frontendDist, 'index.html'));
  });
}

// -------------------------------------------------------------
// Server Initialization
// -------------------------------------------------------------
async function startServer() {
  try {
    await initDB();
    console.log('📦 Database initialized.');

    const existingVoters = await getAllVoters();
    if (existingVoters.length === 0) {
      console.log('🔄 Initializing ARMTI Faculty roster from Google Sheet...');
      try {
        await syncGoogleSheetRoster();
      } catch (syncErr) {
        console.warn('⚠️ Initial Google Sheet sync notice:', syncErr.message);
      }
    } else {
      console.log(`👥 Loaded ${existingVoters.length} ARMTI Faculty members from database.`);
    }

    app.listen(PORT, () => {
      console.log(`🚀 ARMTI Faculty Voting Backend API running at: http://localhost:${PORT}`);
      console.log(`🔐 Admin Protection: Active (ADMIN_PIN configured)`);
    });
  } catch (err) {
    console.error('❌ Failed to start server:', err);
    process.exit(1);
  }
}

startServer();
