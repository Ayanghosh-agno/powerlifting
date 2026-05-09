import { jsPDF } from "jspdf";
import { autoTable } from "jspdf-autotable";
import type { Attempt, CompetitionMode, Lifter } from "./types";

export type RankedLifterForPdf = Lifter & { total: number; points: number };

export type ScoreboardPdfInput = {
  competitionName: string;
  competitionMode: CompetitionMode;
  activeGroupFilter: string | null;
  rankingByGroup: { groupName: string; members: RankedLifterForPdf[] }[];
  ungroupedRanking: RankedLifterForPdf[];
};

function attemptCell(a: Attempt): string {
  if (a.weight === "") return "-";
  const w = typeof a.weight === "number" ? String(a.weight) : String(a.weight);
  if (a.status === "NO") return `${w} (NO)`;
  return w;
}

function lifterToRow(lifter: RankedLifterForPdf, idx: number, isBenchOnly: boolean): string[] {
  const bw = typeof lifter.bodyweight === "number" ? String(lifter.bodyweight) : "-";
  const cat = (lifter.category || "").trim() || "-";
  const base: string[] = [String(idx + 1), lifter.name || "-", cat, lifter.team || "-", bw];
  if (isBenchOnly) {
    return [
      ...base,
      attemptCell(lifter.benchAttempts[0]),
      attemptCell(lifter.benchAttempts[1]),
      attemptCell(lifter.benchAttempts[2]),
      lifter.total > 0 ? String(lifter.total) : "-",
      lifter.points ? String(lifter.points) : "-",
    ];
  }
  return [
    ...base,
    attemptCell(lifter.squatAttempts[0]),
    attemptCell(lifter.squatAttempts[1]),
    attemptCell(lifter.squatAttempts[2]),
    attemptCell(lifter.benchAttempts[0]),
    attemptCell(lifter.benchAttempts[1]),
    attemptCell(lifter.benchAttempts[2]),
    attemptCell(lifter.deadliftAttempts[0]),
    attemptCell(lifter.deadliftAttempts[1]),
    attemptCell(lifter.deadliftAttempts[2]),
    lifter.total > 0 ? String(lifter.total) : "-",
    lifter.points ? String(lifter.points) : "-",
  ];
}

function sanitizeFilename(name: string): string {
  const s = name.replace(/[^\w\-]+/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "").slice(0, 72);
  return s || "scoreboard";
}

export function downloadScoreboardPdf(input: ScoreboardPdfInput): void {
  const { competitionName, competitionMode, activeGroupFilter, rankingByGroup, ungroupedRanking } = input;
  const isBenchOnly = competitionMode === "BENCH_ONLY";
  const head = isBenchOnly
    ? [["#", "Lifter", "Category", "Team", "BW", "BP1", "BP2", "BP3", "Total", "GL"]]
    : [
        [
          "#",
          "Lifter",
          "Category",
          "Team",
          "BW",
          "SQ1",
          "SQ2",
          "SQ3",
          "BP1",
          "BP2",
          "BP3",
          "DL1",
          "DL2",
          "DL3",
          "Total",
          "GL",
        ],
      ];

  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });

  let y = 12;
  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.text(competitionName.trim() || "Scoreboard", 14, y);
  y += 6;
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  const modeLabel = isBenchOnly ? "Bench only" : "Full power";
  doc.text(`${modeLabel} · Generated ${new Date().toLocaleString()}`, 14, y);
  y += 5;
  if (activeGroupFilter) {
    doc.text(`Group filter: ${activeGroupFilter}`, 14, y);
    y += 5;
  }
  y += 4;

  const ensureSpace = (neededMm: number) => {
    const pageH = doc.internal.pageSize.getHeight();
    if (y + neededMm > pageH - 12) {
      doc.addPage();
      y = 14;
    }
  };

  const drawSection = (sectionTitle: string, members: RankedLifterForPdf[]) => {
    if (members.length === 0) return;

    ensureSpace(28);
    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.text(sectionTitle, 14, y);
    y += 6;
    doc.setFont("helvetica", "normal");

    const body = members.map((lifter, idx) => lifterToRow(lifter, idx, isBenchOnly));

    autoTable(doc, {
      startY: y,
      head,
      body,
      theme: "grid",
      styles: { fontSize: 7, cellPadding: 1.2, overflow: "linebreak" },
      headStyles: { fillColor: [33, 37, 41], textColor: 255, fontStyle: "bold" },
      alternateRowStyles: { fillColor: [248, 249, 250] },
      margin: { left: 14, right: 14 },
      tableWidth: "auto",
      showHead: "everyPage",
    });

    const last = (doc as { lastAutoTable?: { finalY: number } }).lastAutoTable;
    y = (last?.finalY ?? y) + 10;
  };

  for (const { groupName, members } of rankingByGroup) {
    drawSection(groupName || "Unassigned", members);
  }

  if (ungroupedRanking.length > 0) {
    const title = rankingByGroup.length > 0 ? "Ungrouped" : "Results";
    drawSection(title, ungroupedRanking);
  }

  const empty =
    rankingByGroup.every((g) => g.members.length === 0) && ungroupedRanking.length === 0;
  if (empty) {
    ensureSpace(12);
    doc.setFontSize(11);
    doc.setFont("helvetica", "normal");
    doc.text("No lifters in results yet.", 14, y);
  }

  doc.save(`${sanitizeFilename(competitionName)}-${new Date().toISOString().slice(0, 10)}.pdf`);
}
