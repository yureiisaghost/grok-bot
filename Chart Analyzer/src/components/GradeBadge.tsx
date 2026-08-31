import type { Grade } from "../types"

function gradeClass(grade: Grade) {
  if (grade === "Candidate") return "candidate"
  if (grade === "Developing") return "developing"
  return "pass"
}

export function GradeBadge({ grade, size = "md" }: { grade: Grade; size?: "md" | "lg" }) {
  return (
    <span className={`badge ${gradeClass(grade)} ${size === "lg" ? "lg" : ""}`} title={grade}>
      {grade}
    </span>
  )
}
