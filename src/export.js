import * as XLSX from 'xlsx';
import { getResults, getAllVoters, getElectionStatus, getResearchPublications } from './db.js';

export async function generateExcelReport() {
  const resultsData = await getResults();
  const allVoters = await getAllVoters();
  const electionStatus = await getElectionStatus();
  const researchPublications = await getResearchPublications();
  const generatedAt = new Date().toLocaleString();

  const wb = XLSX.utils.book_new();

  // 1. Executive Summary & Winners
  const summaryRows = [
    ['ARMTI FACULTY AWARDS - OFFICIAL RESULTS REPORT'],
    ['Generated At:', generatedAt],
    ['Election Status:', electionStatus],
    [''],
    ['TURNOUT METRICS'],
    ['Total Eligible Faculty:', resultsData.turnout.total_eligible],
    ['Total Ballots Cast:', resultsData.turnout.total_voted],
    ['Voter Turnout Rate:', `${resultsData.turnout.percentage}%`],
    ['Pending / Abstained:', resultsData.turnout.pending],
    [''],
    ['AWARD CATEGORY WINNERS OVERVIEW'],
    ['#', 'Award Category', 'Winner (1st Place)', 'Department', 'Votes', 'Vote Share (%)']
  ];

  resultsData.categories.forEach((cat, idx) => {
    const winner = cat.tallies.length > 0 ? cat.tallies[0] : null;
    summaryRows.push([
      idx + 1,
      cat.category_title,
      winner ? winner.nominee_name : 'No votes recorded',
      winner ? (winner.nominee_dept || 'N/A') : 'N/A',
      winner ? winner.vote_count : 0,
      winner ? `${winner.percentage}%` : '0%'
    ]);
  });

  const wsSummary = XLSX.utils.aoa_to_sheet(summaryRows);
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Executive Summary');

  // 2. Detailed Category Standings
  const detailRows = [
    ['Award Category', 'Rank', 'Nominee Name', 'Nominee Department', 'Vote Count', 'Percentage Share']
  ];

  resultsData.categories.forEach((cat) => {
    if (cat.tallies.length === 0) {
      detailRows.push([cat.category_title, '-', 'No Votes Cast', '-', 0, '0.0%']);
    } else {
      cat.tallies.forEach((tally) => {
        detailRows.push([
          cat.category_title,
          tally.rank,
          tally.nominee_name,
          tally.nominee_dept || 'N/A',
          tally.vote_count,
          `${tally.percentage}%`
        ]);
      });
    }
  });

  const wsDetails = XLSX.utils.aoa_to_sheet(detailRows);
  XLSX.utils.book_append_sheet(wb, wsDetails, 'Detailed Standings');

  // 3. Turnout Audit (Who Voted vs Pending - Secrecy Preserved)
  const auditRows = [
    ['Staff ID', 'Faculty Member Name', 'Department', 'Division', 'Status', 'Timestamp / Receipt Ref']
  ];

  allVoters.forEach((v) => {
    auditRows.push([
      v.staff_id,
      v.full_name,
      v.department || 'N/A',
      v.division || 'N/A',
      v.has_voted ? 'VOTED' : 'PENDING',
      v.has_voted ? (v.voted_at || 'Verified') : 'Not yet cast'
    ]);
  });

  const wsAudit = XLSX.utils.aoa_to_sheet(auditRows);
  XLSX.utils.book_append_sheet(wb, wsAudit, 'Turnout Roster Audit');

  // 4. Research Publications & DOI Audit (For Best Researcher verification)
  const pubRows = [
    ['Nominee Name', 'Nominee Department', 'Award Category', 'Publications & DOI Citations Provided', 'Receipt Ref', 'Submission Date']
  ];

  if (researchPublications.length === 0) {
    pubRows.push(['No publications/DOIs submitted yet', '-', 'Best Researcher', 'N/A', '-', '-']);
  } else {
    researchPublications.forEach((p) => {
      pubRows.push([
        p.nominee_name,
        p.nominee_dept || 'N/A',
        p.category_title,
        p.citations,
        p.receipt_code || 'Secret Ballot',
        p.created_at ? new Date(p.created_at).toLocaleString() : 'N/A'
      ]);
    });
  }

  const wsPubs = XLSX.utils.aoa_to_sheet(pubRows);
  XLSX.utils.book_append_sheet(wb, wsPubs, 'Research Publications & DOIs');

  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  return buffer;
}

