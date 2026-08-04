# Third-party assets

`entrybot1.svg`, `entrybot2.svg`, `entrybot1.png`, `entrybot2.png` and `bark.mp3`
are copied verbatim from [entrylabs/entryjs](https://github.com/entrylabs/entryjs)
(`images/media/`).

    EntryJS
    Copyright 2015 Entry Labs
    Licensed under the Apache License, Version 2.0
    http://www.apache.org/licenses/LICENSE-2.0

They are the default Entrybot sprite pictures and sound that Entry's start
project references, and every `.ent` this server produces must embed them, so
they are vendored here rather than fetched at install time. The rest of this
repository is MIT licensed; these five files remain under Apache-2.0.

PNG copies are required because playentry.org `.ent` import expects a raster
thumb (`…/thumb/{fileId}.png`) alongside the SVG runtime image.

To refresh them from upstream:

    npm run fetch:entryjs
    cp vendor/entryjs/images/media/{entrybot1.svg,entrybot2.svg,entrybot1.png,entrybot2.png,bark.mp3} assets/media/
