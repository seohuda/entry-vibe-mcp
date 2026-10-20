#!/usr/bin/env python3
"""Rebuild EntryVibe's original MIT-licensed demonstration library assets.

Requires Python 3, `pip install cairosvg`, and ffmpeg only while rebuilding.
The installed MCP server uses the committed PNG/MP3 files without these tools.
Every illustration below is drawn from geometric shapes created for this
repository; no Entry library media or third-party artwork is used.
"""

from pathlib import Path
import subprocess
import cairosvg


ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / "assets" / "library" / "media"
OUTLINE = "#243047"


def svg(body: str, width: int = 160, height: int = 160) -> str:
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" '
        f'viewBox="0 0 {width} {height}">'
        f'<g stroke="{OUTLINE}" stroke-width="4" stroke-linecap="round" '
        f'stroke-linejoin="round">{body}</g></svg>'
    )


def cat(second_pose: bool) -> str:
    legs = (
        '<path d="M55 112 L40 136 L59 136 M103 112 L119 136 L137 136" '
        'fill="none" stroke="#cf7b32" stroke-width="15"/>'
        if second_pose else
        '<path d="M55 112 L62 136 L79 136 M103 112 L95 136 L114 136" '
        'fill="none" stroke="#cf7b32" stroke-width="15"/>'
    )
    return svg(
        '<path d="M42 105 Q17 94 21 75 Q24 62 35 74" fill="none" '
        'stroke="#e9a24b" stroke-width="13"/>'
        + legs
        + '<ellipse cx="79" cy="103" rx="41" ry="27" fill="#f2b359"/>'
        '<ellipse cx="79" cy="108" rx="23" ry="17" fill="#fff0d2" stroke="none"/>'
        '<path d="M45 43 L43 15 L66 29 M93 29 L116 15 L114 45" fill="#f2b359"/>'
        '<path d="M51 35 L50 25 L59 31 M101 31 L110 25 L108 36" '
        'fill="#ef9ca3" stroke="none"/>'
        '<ellipse cx="79" cy="52" rx="38" ry="30" fill="#f2b359"/>'
        '<path d="M70 26 L73 37 M81 24 L81 35 M92 26 L89 37" '
        'stroke="#cf7b32" stroke-width="5"/>'
        '<ellipse cx="64" cy="49" rx="4" ry="6" fill="#243047" stroke="none"/>'
        '<ellipse cx="94" cy="49" rx="4" ry="6" fill="#243047" stroke="none"/>'
        '<path d="M74 59 L84 59 L79 65 Z" fill="#d96d81" stroke="none"/>'
        '<path d="M79 65 Q72 73 67 66 M79 65 Q86 73 91 66" fill="none" stroke-width="2"/>'
        '<path d="M42 57 L27 54 M42 65 L26 69 M116 57 L131 54 M116 65 L132 69" '
        'fill="none" stroke-width="2"/>'
        '<path d="M58 84 Q80 96 101 84" fill="none" stroke="#4488ba" stroke-width="7"/>'
        '<circle cx="80" cy="92" r="5" fill="#ffdf69" stroke-width="2"/>'
    )


ART = {
    "cat-walk1": cat(False),
    "cat-walk2": cat(True),
    "dog": svg(
        '<path d="M42 106 Q18 98 24 80" fill="none" stroke="#ab7150" stroke-width="14"/>'
        '<path d="M53 112 L50 139 L68 139 M106 112 L109 139 L127 139" '
        'fill="none" stroke="#ab7150" stroke-width="15"/>'
        '<ellipse cx="81" cy="106" rx="41" ry="26" fill="#c89262"/>'
        '<path d="M43 42 Q17 35 25 74 Q35 87 47 63 M116 42 Q141 35 134 74 '
        'Q124 87 112 63" fill="#815337"/>'
        '<ellipse cx="80" cy="53" rx="37" ry="33" fill="#c89262"/>'
        '<path d="M70 23 Q56 37 68 55 Q80 65 88 53 L89 22" '
        'fill="#f7dfb9" stroke="none"/>'
        '<ellipse cx="65" cy="50" rx="4" ry="6" fill="#243047" stroke="none"/>'
        '<ellipse cx="95" cy="50" rx="4" ry="6" fill="#243047" stroke="none"/>'
        '<ellipse cx="80" cy="68" rx="20" ry="14" fill="#f7dfb9" stroke="none"/>'
        '<path d="M73 61 Q80 56 87 61 Q88 67 80 69 Q72 67 73 61" fill="#243047"/>'
        '<path d="M80 70 L80 75 Q86 85 91 74" fill="#e78a9c" stroke-width="2"/>'
        '<path d="M54 84 Q80 95 105 83" fill="none" stroke="#e15f66" stroke-width="8"/>'
        '<path d="M80 91 L86 97 L80 103 L74 97 Z" fill="#ffdf69" stroke-width="2"/>'
    ),
    "car": svg(
        '<path d="M22 77 L43 72 L59 45 Q63 39 73 39 L108 39 Q116 39 121 47 '
        'L137 73 L145 79 L145 111 L16 111 L16 89 Q16 81 22 77 Z" fill="#e95e5f"/>'
        '<path d="M49 72 L65 47 L82 47 L82 72 Z M90 47 L108 47 L123 72 '
        'L90 72 Z" fill="#b9e1ed" stroke-width="3"/>'
        '<path d="M21 83 L39 83 L39 96 L20 96 M129 83 L143 83 L143 96 '
        'L129 96" fill="#ffe592" stroke-width="2"/>'
        '<path d="M59 81 L67 81 M97 81 L105 81" stroke="#fff0d2" stroke-width="3"/>'
        '<path d="M85 77 L85 104" stroke-width="2" opacity=".5"/>'
        '<rect x="12" y="103" width="136" height="12" rx="5" fill="#8297a8"/>'
        '<circle cx="44" cy="115" r="19" fill="#243047"/>'
        '<circle cx="118" cy="115" r="19" fill="#243047"/>'
        '<circle cx="44" cy="115" r="9" fill="#c7d8df" stroke-width="2"/>'
        '<circle cx="118" cy="115" r="9" fill="#c7d8df" stroke-width="2"/>'
        '<path d="M5 67 L24 67 M3 79 L11 79" stroke="#8297a8" stroke-width="3"/>'
    ),
    "rocket": svg(
        '<path d="M64 114 Q57 132 70 150 L80 141 L90 150 Q103 132 96 114" '
        'fill="#f9aa3f"/>'
        '<path d="M73 115 Q69 132 80 141 Q91 132 87 115" fill="#ffe58b" stroke="none"/>'
        '<path d="M55 77 Q31 87 31 124 L61 109 M105 77 Q129 87 129 124 '
        'L99 109" fill="#e95e5f"/>'
        '<path d="M80 10 Q48 37 51 96 L58 115 L102 115 L109 96 '
        'Q112 37 80 10 Z" fill="#edf3f6"/>'
        '<path d="M80 10 Q65 23 58 41 L102 41 Q95 23 80 10" fill="#e95e5f"/>'
        '<circle cx="80" cy="66" r="18" fill="#75bace"/>'
        '<path d="M72 57 Q80 52 88 58" fill="none" stroke="#e9fbff" stroke-width="4"/>'
        '<path d="M57 101 L103 101" stroke="#8297a8"/>'
        '<path d="M80 91 L80 122" stroke="#e95e5f" stroke-width="8"/>'
    ),
    "meteor": svg(
        '<path d="M70 51 L136 17 L114 53 L149 42 L117 80 L143 73 L114 108 '
        'L72 116 Z" fill="#f7b64b" stroke="none"/>'
        '<path d="M85 61 L123 35 L100 72 L128 60 L106 94 L79 106 Z" '
        'fill="#ffdc85" stroke="none"/>'
        '<path d="M37 59 L59 47 L88 56 L108 78 L104 108 L83 131 L54 138 '
        'L29 120 L17 96 L23 74 Z" fill="#967d78"/>'
        '<path d="M29 120 L54 138 L83 131 L104 108 L81 117 L61 127 '
        'L43 115 L27 89 L17 96 Z" fill="#6d636b" stroke="none"/>'
        '<ellipse cx="49" cy="82" rx="13" ry="10" transform="rotate(-24 49 82)" '
        'fill="#6d636b" stroke="#b59c91" stroke-width="3"/>'
        '<circle cx="79" cy="103" r="10" fill="#6d636b" stroke="#b59c91" stroke-width="3"/>'
        '<circle cx="76" cy="71" r="5" fill="#b59c91" stroke="none"/>'
        '<path d="M38 106 L45 115 M88 86 L94 89" stroke="#b59c91" stroke-width="4"/>'
    ),
}

stars = "".join(
    f'<circle cx="{(i * 137 + 31) % 960}" cy="{(i * 83 + 29) % 540}" '
    f'r="{1 + i % 3}" fill="{["#d8ebff", "#aebeea", "#ffffff"][i % 3]}" stroke="none"/>'
    for i in range(65)
)
ART["space"] = svg(
    '<rect width="960" height="540" fill="#14203b" stroke="none"/>'
    '<ellipse cx="520" cy="245" rx="400" ry="210" fill="#1b294a" stroke="none"/>'
    + stars
    + '<circle cx="770" cy="134" r="67" fill="#9e8bca" stroke="#baa6de" stroke-width="4"/>'
    '<path d="M713 103 Q767 125 824 98 M706 132 Q766 154 835 128 '
    'M716 165 Q778 183 826 158" fill="none" stroke="#b5a1da" stroke-width="10"/>'
    '<ellipse cx="770" cy="142" rx="108" ry="21" transform="rotate(-20 770 142)" '
    'fill="none" stroke="#e4c69a" stroke-width="10"/>'
    '<circle cx="145" cy="428" r="103" fill="#3b7d9c" stroke="#5eacbd" stroke-width="4"/>'
    '<path d="M62 369 L105 354 L146 380 L127 414 L165 441 L145 478 '
    'L100 465 L87 428 L49 415 M176 336 L206 357 L232 396 L197 410 '
    'L181 378" fill="#73b2a7" stroke="none"/>',
    960,
    540,
)


def main() -> None:
    DEST.mkdir(parents=True, exist_ok=True)
    for name, source in ART.items():
        cairosvg.svg2png(bytestring=source.encode("utf-8"), write_to=str(DEST / (name + ".png")))
    subprocess.run(
        [
            "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
            "-f", "lavfi", "-i", "sine=frequency=660:sample_rate=44100:duration=0.4",
            "-af", "afade=t=in:st=0:d=0.02,afade=t=out:st=0.28:d=0.12,volume=0.3",
            "-codec:a", "libmp3lame", "-b:a", "64k", "-map_metadata", "-1",
            "-fflags", "+bitexact", "-flags:a", "+bitexact", str(DEST / "beep.mp3"),
        ],
        check=True,
    )
    print(f"Generated {len(ART)} original PNG images and beep.mp3 in {DEST}")


if __name__ == "__main__":
    main()
