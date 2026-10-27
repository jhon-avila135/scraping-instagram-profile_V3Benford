"""Benford's law check on the follower counts of the accounts in a profile's audience.

The idea: in a natural population of accounts, the first digit of a quantity that spans several
orders of magnitude (like follower counts) is 1 about 30% of the time and 9 only about 5%.
Bots and purchased followers tend to break that pattern. A deviation is a signal, not proof.
"""

from __future__ import annotations

import json
import math
import statistics
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

DATA_DIR = Path(__file__).parent / "data"
MIN_SAMPLE = 200
MIN_MAGNITUDE_SPAN = 2.0
EXPECTED = {digit: math.log10(1 + 1 / digit) for digit in range(1, 10)}
MAD_CHANCE = 0.235  # a sample that truly follows Benford has a mean absolute deviation of about 0.235 / sqrt(n)
SUBJECTS = {"followers": "audience", "following": "followed accounts"}


class BenfordError(ValueError):
    """The sample is too small to run the check."""


def first_digit(number: int) -> int:
    """Return the leading digit of a positive integer."""
    return int(str(number)[0])


def chi_square_p_value(statistic: float) -> float:
    """Return P(X >= statistic) for a chi-square variable with 8 degrees of freedom.

    For an even number of degrees of freedom (2m) the survival function has a closed form,
    exp(-x/2) * sum((x/2)^k / k!) for k < m, so no statistics library is needed. Here m = 4.
    """
    half = statistic / 2
    return math.exp(-half) * sum(half**k / math.factorial(k) for k in range(4))


def analyze(counts: list[int], list_kind: str = "followers") -> dict:
    """Compare the first digits of `counts` with Benford's curve and return the evidence.

    The verdict uses the chi-square p-value, which accounts for the sample size. The mean absolute
    deviation (MAD) is reported next to the value expected by chance, because the fixed limits
    published for it assume samples of thousands: with 200 accounts even a perfect Benford
    sample has a MAD above 0.015. Zeros have no first digit, so they are left out of the test;
    their share is reported separately because many accounts with zero followers is a bot signal.
    """
    positives = [count for count in counts if count > 0]
    sample = len(positives)
    if sample < MIN_SAMPLE:
        raise BenfordError(f"Only {sample} accounts with followers could be read; at least {MIN_SAMPLE} are needed.")

    seen = Counter(first_digit(count) for count in positives)
    digits = [
        {"digit": digit, "count": seen[digit], "observed": seen[digit] / sample, "expected": EXPECTED[digit]}
        for digit in range(1, 10)
    ]
    chi_square = sum((row["count"] - sample * row["expected"]) ** 2 / (sample * row["expected"]) for row in digits)
    p_value = chi_square_p_value(chi_square)
    mad = statistics.fmean(abs(row["observed"] - row["expected"]) for row in digits)
    span = math.log10(max(positives) / min(positives))
    zeros = len(counts) - sample

    level = "consistent" if p_value >= 0.05 else "inconclusive" if p_value >= 0.01 else "deviates"
    if level == "deviates" and span < MIN_MAGNITUDE_SPAN:
        level = "inconclusive"

    subject = SUBJECTS.get(list_kind, "audience")
    headline, explanation = {
        "consistent": (
            "No significant deviation from Benford's law",
            f"The first digits are close enough to Benford's curve that chance alone explains the difference, as expected for a "
            f"varied {subject} of real accounts. It does not prove that every account is real.",
        ),
        "inconclusive": (
            "Inconclusive",
            f"The pattern deviates somewhat (p between 0.01 and 0.05), or the counts are too narrow for the law to apply, "
            f"which is not strong enough evidence either way about the {subject}.",
        ),
        "deviates": (
            "Deviates from Benford's law",
            f"The first digits differ clearly from the expected curve. That can happen when many accounts in the {subject} "
            "are bots or bought, but also with unusual audiences. Treat it as a reason to look closer, not as proof.",
        ),
    }[level]

    notes = []
    if span < MIN_MAGNITUDE_SPAN:
        notes.append(
            f"The follower counts span only {span:.1f} orders of magnitude. Benford's law needs at least "
            f"{MIN_MAGNITUDE_SPAN:.0f}, so a deviation here says little."
        )
    if zeros and zeros / len(counts) >= 0.15:
        notes.append(f"{zeros / len(counts):.0%} of the visited accounts have 0 followers, which is common among bots.")
    if sample < 2 * MIN_SAMPLE:
        notes.append("With about 200 accounts only strong deviations can be detected. A larger sample makes the test more sensitive.")

    return {
        "sample": sample,
        "visited": len(counts),
        "zeros": zeros,
        "digits": digits,
        "chi_square": round(chi_square, 2),
        "p_value": round(p_value, 4),
        "mad": round(mad, 4),
        "mad_chance": round(MAD_CHANCE / math.sqrt(sample), 4),
        "span": round(span, 2),
        "level": level,
        "headline": headline,
        "explanation": explanation,
        "notes": notes,
    }


def build_record(username: str, list_kind: str, counts: list[int]) -> dict:
    """Return what is saved for a profile: who was checked, the counts and the analysis.

    Only integers are stored. The usernames of the sampled accounts are never written to disk.
    """
    return {
        "username": username,
        "list": list_kind,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "counts": counts,
        "analysis": analyze(counts, list_kind),
    }


def save_record(record: dict) -> None:
    """Write the record to data/benford.json."""
    DATA_DIR.mkdir(exist_ok=True)
    (DATA_DIR / "benford.json").write_text(json.dumps(record, indent=2), encoding="utf-8")


def main() -> None:
    """Re-run the analysis on the counts saved in data/benford.json and print the digit table."""
    path = DATA_DIR / "benford.json"
    if not path.exists():
        sys.exit("error: data/benford.json not found. Run the Benford check from the dashboard first.")
    record = json.loads(path.read_text(encoding="utf-8"))
    try:
        result = analyze(record["counts"], record["list"])
    except BenfordError as error:
        sys.exit(f"error: {error}")
    print(f"{record['username']} ({record['list']}): {result['headline']}")
    print(f"sample={result['sample']}  MAD={result['mad']} (about {result['mad_chance']} expected by chance)  "
          f"chi2={result['chi_square']}  p={result['p_value']}")
    print("digit  observed  expected")
    for row in result["digits"]:
        print(f"{row['digit']:>5}  {row['observed']:>7.1%}  {row['expected']:>8.1%}")


if __name__ == "__main__":
    main()
