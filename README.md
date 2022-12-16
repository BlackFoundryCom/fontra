# Fontra

![Fontra Icon](https://github.com/BlackFoundryCom/fontra/blob/main/fontra-icon.svg?raw=true)

Fontra is an in-development browser-based font editor. It consists of two main parts:

- Fontra client — runs in the browser, written in JavaScript
- Fontra server — runs locally or on a remote machine, written in Python

## Installing Fontra

- Check out the repo, cd into the root of the repo

- Ensure you have Python >= 3.10 installed, preferably from [python.org](https://www.python.org/downloads/)

- Create a Python venv in the root of the repo:

    `python3.10 -m venv venv --prompt=fontra`

    (Replace `python3.10` with `python3.11` if you have 3.11 instead.)

- Activate venv:

    `source venv/bin/activate`

- Install dependencies:

    `pip install --upgrade pip`

    `pip install -r requirements.txt`

    `pip install -e .`

- Start the fontra server with a path to a folder containing fonts (.designspace, .ufo, .ttf or .otf), using the `filesystem` subcommand:

    `fontra --launch filesystem /path/to/a/folder`

- The default browser will then navigate to:

    `http://localhost:8000/`

- To use Fontra with .rcjk data on disk, or to connect to a remote rcjk server, install the [`fontra-rcjk`](https://github.com/BlackFoundryCom/fontra-rcjk) plugin package. Then you can start it with a robocjk server hostname, using the `rcjk` subcommand provided by the `fontra-rcjk` plugin:

    `fontra --launch rcjk some-robocjk-server.some-domain.com`

## Roadmap

The following list of features is not complete, but gives you a rough idea of where we are now, and where we are headed. A green checkmark means: “This feature has been implemented”.

### Input / Output

- Read .designspace ✅
- Write .designspace
- Respond to external .designspace changes (automatic reload)
- Read .ufo ✅
- Write .ufo ✅
- Respond to external .ufo changes (automatic reload) ✅
- Read .ttf + variable .ttf ✅
- Read .otf + variable .otf ✅
- Write .ttf + variable .ttf (For “hot fixes”. Currently not planned, will still require export step.)
- Write .otf + variable .otf (Ditto.)
- Respond to external .ttf and .otf changes (automatic reload)

### Text viewing / editing

- Basic live text entry, including `/glyphname` notation ✅
- Multi-line text ✅
- Basic glyph selection (pick glyph from list) ✅
- Basic designspace navigation (via axis sliders) ✅
- Show live interpolation ✅
- Hand tool for scrolling ✅
- Scroll with gestures ✅
- Zoom with gestures ✅
- Zoom with short-cuts ✅
- Advanced character / glyph search
- Display kerning
- Apply proper text shaping
- Full screen mode
- Right-to-left mode
- Vertical top-to-bottom mode

### Glyph editing

- Enter “edit mode” for glyph by double-clicking on a glyph in the text ✅
- Basic outline editing (move points) ✅
- Basic pen tool (draw points) ✅
- Edit (variable) component parameters ✅
- Decompose (variable) component ✅
- First-class support for quadratic curves ✅
- Multi-level undo/redo, per glyph ✅
- Interactive sidebearing editing
- Numeric sidebearing editing
- Numeric advance width editing ✅
- Pen tool for quadratic curves
- Advanced outline editing (adding/removing points)
- Connecting open paths
- Knife tool
- Shape tool
- Copy / paste
- Create new glyphs
- Add / remove (variable) components
- Edit local variation axes and sources/layers
- Built-in support for Non-Linear Interpolation
- Remove overlap and other path operators

### Font-level viewing / editing

- Cell-based font overview
- List-based font overview
- Edit kerning
- Edit OpenType features
- Edit variation axes

### Multiple windows

- Propagate changes across multiple windows in real time ✅
- Browser URL encodes most view settings ✅

### Deployment

- Basic standalone desktop application for macOS and Windows ✅ (Via [Fontra Pak](https://github.com/BlackFoundryCom/fontra-pak))
- Basic multi-user server deployment with database storage ✅ (Via [fontra-rcjk](https://github.com/BlackFoundryCom/fontra-rcjk), [django-robo-cjk](https://github.com/BlackFoundryCom/django-robo-cjk), behind NGINX)
- Research GitHub REST API: can Fontra be a GitHub gateway in a practical way?
- Research database solutions for server-based font storage

### Scripting

- A Python scripting library that talks directly to the Fontra server
- JS scripting for in-browser automation
- Python scripting for in-browser automation via WASM/PyOdide
- Add various plug-in APIs, for example:
  - Visualization layer plug-ins for the glyph editor
  - Tool plug-ins

### Export

- FontMake/Fontations integration
- Incremental compilation using Fontations

### Collaborative features

- Visualizing the selection of others
- Add review notes / comments
- Suggested edits

### Code structure

- Client/server architecture (JavaScript/Python) ✅
- Local or (networked) remote server ✅
- Client/server communication via JSON objects over a WebSocket ✅
- Highly modular:
  - Pluggable client views ✅
  - Pluggable read/write storage backends ✅
  - Client-agnostic and storage-agnostic server centerpiece ✅
- Asynchronous programming model using async/await

### Future possibilities

- Serverless Fontra
- Peer-to-peer collaboration
