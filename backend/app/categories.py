CATEGORIES = [
    "software",
    "web",
    "mobile",
    "AI/ML",
    "data",
    "hardware/IoT",
    "robotics",
    "networking",
    "cybersecurity",
    "web3/blockchain",
    "gaming",
    "health",
    "fintech",
    "climate",
    "education",
    "open-ended",
]

FORMATS = ["online", "in_person", "hybrid", "unknown"]
STATUSES = ["upcoming", "open", "ended"]

# Sources whose listings stay hidden until the AI confirms they're real
# hackathons, and are dropped if not: web finds, and Unstop, whose hackathon
# category also holds coding contests, CTFs and quizzes.
VETTED_SOURCES = ["web", "unstop"]

# Web finds and Unstop listings stay hidden until the AI has confirmed they're real hackathons;
# ones you added yourself show at once.
_VETTED = ", ".join(f"'{s}'" for s in VETTED_SOURCES)
VISIBLE = f"NOT is_hidden AND NOT (source IN ({_VETTED}) AND enriched_at IS NULL AND NOT added_by_user)"
