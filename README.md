# TimePlan Tools

TimePlan Tools is a browser userscript that adds additional planning and visualization tools to the TimePlan Department Plan.

It is designed to make the daily roster easier to read and to provide a visual workspace for organizing coworkers during the day.

## Features

### Sorted View
Displays the daily roster in a clearer format, sorted by shift starting time.

It includes:
- Coworker name
- Shift start and end time
- Assigned TimePlan functions
- Function badges and colors
- Automatic handling of continuous and split shifts
- All-day absence filtering

### Board Planning
Provides a visual drag-and-drop workspace for daily operational planning.

The board includes:

**Order Auditor - Coordinator**

**Click & Collect**
- Floor
- MH
- Reachtruck
- TPL
- Extra

**LCD**
- Floor
- MH
- Reachtruck
- Loading & Checking
- TPL
- Extra

**FullServe**
- VULPICKS
- TPL
- Extra

Coworkers can be dragged between the different areas without modifying the original TimePlan roster.

The board also includes:
- Morning and Evening Team separation
- Automatic sorting by shift start time
- Function badges
- Function-colored shift indicators
- Sticky Unassigned area while coworkers are waiting to be assigned

### Export

The daily board can be exported as:

- Interactive HTML
- PDF
- CSV

The Interactive Board can also be opened separately and used as an independent drag-and-drop board.

## Installation

### 1. Install Tampermonkey

Install the Tampermonkey extension in Google Chrome.

### 2. Allow User Scripts

Open:

`chrome://extensions`

Then:

**Tampermonkey → Details → Allow user scripts → ON**

Chrome Developer Mode is not required.

### 3. Install TimePlan Tools

Open:

https://raw.githubusercontent.com/Sachahang/TimePlan-Tools/main/TimePlan-Tools.user.js

Tampermonkey should automatically open the installation page.

Select **Install**.

### 4. Open TimePlan

Open TimePlan and go to:

**Department Plan**

TimePlan Tools should appear automatically.

## Updates

TimePlan Tools supports automatic updates through Tampermonkey.

Once installed from this repository, new versions can be detected and installed automatically by Tampermonkey.

There is normally no need to reinstall the script when a new version is released.

## How it works

TimePlan Tools runs locally in the browser and uses information already available to the logged-in TimePlan session.

The script does not change the original TimePlan roster when using Sorted View or Board Planning.

Board assignments are temporary and are not written back to TimePlan.

## Compatibility

Recommended setup:

- Google Chrome
- Tampermonkey
- TimePlan Department Plan

## Version

Current release: **1.12.4**

## Development

TimePlan Tools is under active development.

New features and improvements are tested before being published to the main version used for automatic updates.
