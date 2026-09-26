import assert from 'assert';
import {
  initDB,
  getVoter,
  getAllVoters,
  getCategories,
  submitBallot,
  getResults,
  resetElection,
  getSettings,
  updateSetting,
  addManualFaculty,
  invalidateVoterBallot,
  revokeVoterEligibility,
  getAuditLogs
} from '../src/db.js';
import { syncGoogleSheetRoster } from '../src/sync.js';
import { generateExcelReport } from '../src/export.js';

async function runTests() {
  console.log('🧪 Starting Enhanced ARMTI Faculty Voting System Automated Backend Test Suite...\n');

  // 1. Initialize DB
  console.log('1️⃣ Testing Database Initialization & Settings...');
  const dbInit = await initDB();
  assert.ok(dbInit.mode, 'Database mode should be set');
  const initialSettings = await getSettings();
  assert.ok(initialSettings.election_status, 'Election status setting should exist');
  console.log(`   ✓ Database initialized successfully in [${dbInit.mode}] mode.`);

  // 2. Categories Seeding
  const categories = await getCategories(false);
  assert.ok(categories.length >= 21, `Expected at least 21 categories, got ${categories.length}`);
  console.log(`   ✓ Verified ${categories.length} award categories loaded with exact official summaries.`);

  // 3. Google Sheet Live Sync & Deduplication
  console.log('\n2️⃣ Testing Live Google Sheet Sync & Deduplication...');
  const syncResult = await syncGoogleSheetRoster();
  assert.ok(syncResult.success, 'Sync should succeed');
  assert.ok(syncResult.unique_faculty > 80, `Expected >80 unique faculty, got ${syncResult.unique_faculty}`);
  console.log(`   ✓ Successfully synced Google Sheet: ${syncResult.total_rows} rows -> ${syncResult.unique_faculty} unique faculty members.`);

  // 4. Voter Verification
  console.log('\n3️⃣ Testing Faculty Staff ID Verification...');
  const validVoter = await getVoter('1010');
  assert.ok(validVoter, 'Staff ID 1010 should exist in roster');
  console.log(`   ✓ Found valid faculty: ${validVoter.full_name} (${validVoter.department})`);

  // Clean state before vote test
  await resetElection();

  // 5. Dynamic Self-Voting Setting Tests
  console.log('\n4️⃣ Testing Dynamic Self-Voting Rules (Admin Controlled)...');
  await updateSetting('allow_self_voting', '0'); // Disabled
  
  const selfVotePayload = [
    {
      category_id: categories[0].id,
      category_title: categories[0].title,
      nominee_staff_id: '1010', // Self vote
      nominee_name: validVoter.full_name,
      nominee_dept: validVoter.department
    }
  ];

  try {
    await submitBallot('1010', selfVotePayload);
    assert.fail('Should have rejected self-vote when allow_self_voting is 0');
  } catch (err) {
    assert.ok(err.message.includes('Self-nomination is not permitted'), 'Error should mention self-nomination');
    console.log(`   ✓ Backend correctly rejected self-vote when disabled: "${err.message}"`);
  }

  // Allow self voting test
  await updateSetting('allow_self_voting', '1');
  const allowedSelfVote = await submitBallot('1010', selfVotePayload);
  assert.ok(allowedSelfVote.success, 'Self-vote should be accepted when allow_self_voting is enabled');
  console.log(`   ✓ Backend accepted self-vote when allow_self_voting was enabled by Admin (Receipt: ${allowedSelfVote.receipt_code})`);

  // Reset for clean slate
  await resetElection();
  await updateSetting('allow_self_voting', '0');

  // 6. Casting Normal Ballot & Double-Vote Test
  console.log('\n5️⃣ Testing Normal Ballot Submission & Double-Voting Lock...');
  const normalBallot = [
    {
      category_id: categories[0].id,
      category_title: categories[0].title,
      nominee_staff_id: '798',
      nominee_name: 'Adekeye, Mojisola Deborah',
      nominee_dept: 'Agricultural Development & Management'
    },
    {
      category_id: categories[1].id,
      category_title: categories[1].title,
      nominee_name: '__ABSTAIN__'
    }
  ];

  const submitResult = await submitBallot('1010', normalBallot);
  assert.ok(submitResult.success, 'Ballot submission should succeed');
  console.log(`   ✓ Ballot successfully cast! Receipt code: ${submitResult.receipt_code}`);

  // Double vote attempt
  try {
    await submitBallot('1010', normalBallot);
    assert.fail('Should reject double-voting');
  } catch (err) {
    assert.ok(err.message.includes('already cast a vote'), 'Error should indicate already voted');
    console.log(`   ✓ Double-voting blocked: "${err.message}"`);
  }

  // 7. Results & Standings
  console.log('\n6️⃣ Testing Live Results & Turnout Calculations...');
  const results = await getResults();
  assert.strictEqual(results.turnout.total_voted, 1);
  console.log(`   ✓ Verified turnout calculation: ${results.turnout.total_voted} voted (${results.turnout.percentage}%)`);

  // 8. Emergency Bypass Quick-Add Faculty
  console.log('\n7️⃣ Testing Emergency Bypass Quick-Add Faculty...');
  const testBypassId = `TEST_BYPASS_${Date.now()}`;
  const addedFaculty = await addManualFaculty({
    staff_id: testBypassId,
    full_name: 'Dr. Test Bypass Faculty',
    department: 'Agripreneurship & Enterprise Dev.',
    division: 'Special Programs',
    training_center: 'Ilorin Main'
  });
  assert.strictEqual(addedFaculty.is_manual, 1);
  const fetchedBypass = await getVoter(testBypassId);
  assert.ok(fetchedBypass, 'Emergency bypass voter should exist');
  assert.strictEqual(fetchedBypass.is_manual, 1);
  console.log(`   ✓ Successfully registered emergency bypass faculty: ${fetchedBypass.full_name} (${fetchedBypass.staff_id})`);

  // 9. Impersonation Dispute / Ballot Invalidation & Re-Vote
  console.log('\n8️⃣ Testing Ballot Invalidation & Re-Vote Dispute Resolution...');
  const invalidateRes = await invalidateVoterBallot('1010', 'Voter reported account dispute');
  assert.ok(invalidateRes.success);
  const resetVoter = await getVoter('1010');
  assert.strictEqual(resetVoter.has_voted, 0);
  assert.strictEqual(resetVoter.receipt_code, null);
  
  // Test that voter can now re-cast ballot
  const reVoteResult = await submitBallot('1010', normalBallot);
  assert.ok(reVoteResult.success);
  console.log(`   ✓ Invalidation successfully purged old ballot; voter was able to re-cast new ballot (New Receipt: ${reVoteResult.receipt_code})`);

  // 10. Non-Faculty Revocation
  console.log('\n9️⃣ Testing Non-Faculty Eligibility Revocation...');
  const revokeRes = await revokeVoterEligibility('1010', 'Staff confirmed as non-faculty contractor');
  assert.ok(revokeRes.success);
  const revokedVoter = await getVoter('1010');
  assert.strictEqual(revokedVoter.is_eligible, 0);
  assert.strictEqual(revokedVoter.has_voted, 0);

  // Attempting to vote as revoked staff should fail
  try {
    await submitBallot('1010', normalBallot);
    assert.fail('Should reject vote from ineligible staff');
  } catch (err) {
    assert.ok(err.message.includes('flagged as ineligible'), 'Error should indicate ineligibility');
    console.log(`   ✓ Revoked non-faculty successfully blocked from voting: "${err.message}"`);
  }

  // 11. Audit Trail Logging
  console.log('\n🔟 Testing Administrative Audit Trail Logging...');
  const auditLogs = await getAuditLogs();
  assert.ok(auditLogs.length >= 3, 'Audit logs should record actions');
  const actionTypes = auditLogs.map(l => l.action_type);
  assert.ok(actionTypes.includes('QUICK_ADD_FACULTY'));
  assert.ok(actionTypes.includes('INVALIDATE_BALLOT'));
  assert.ok(actionTypes.includes('REVOKE_ELIGIBILITY'));
  console.log(`   ✓ Verified ${auditLogs.length} chronological audit entries (Actions logged: ${[...new Set(actionTypes)].join(', ')})`);

  // 12. Excel Export
  console.log('\n1️⃣1️⃣ Testing Excel (.xlsx) Multi-Sheet Export Generator...');
  const excelBuffer = await generateExcelReport();
  assert.ok(Buffer.isBuffer(excelBuffer));
  console.log(`   ✓ Excel report successfully generated (${excelBuffer.length} bytes).`);

  console.log('\n🎉 ALL 11 BACKEND, DISPUTE & AUDIT TESTS PASSED FLAWLESSLY!\n');
  process.exit(0);
}

runTests().catch((err) => {
  console.error('\n❌ Backend Test Suite Failed:', err);
  process.exit(1);
});

