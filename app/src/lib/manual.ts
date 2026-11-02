/**
 * The user manual, as data (2026-10-11). One source for two things: the
 * Help → User Manual screen, and what the Chat Support helper knows. Keep it
 * in step with the app — and with the printed manual (v2.0).
 *
 * Text may mark words **bold**.
 */
export interface ManualPart {
  /** A small heading above this part. */
  heading?: string;
  /** Plain bullet points. */
  list?: string[];
  /** Numbered steps: who does it, what, and the details under it. */
  steps?: { who: string; what: string; details?: string[] }[];
  /** A two-column table: [left, right]. */
  rows?: [string, string][];
  /** A highlighted tip. */
  note?: string;
}
export interface ManualSection {
  id: string;
  title: string;
  intro?: string;
  parts: ManualPart[];
}

export const MANUAL_VERSION = '2.0';
export const MANUAL_UPDATED = 'October 27, 2026';

export const MANUAL: ManualSection[] = [
  {
    id: 'start',
    title: 'Getting started',
    parts: [{
      list: [
        'Sign in with the **username** and **password** given to you by the admin.',
        'The first time you sign in, the app asks you to **choose your own password**. Do not share it.',
        'Forgot your password? Tell an admin. They can give you a new temporary one.',
        'When a new version is out, the app shows **A new version of the tracker is ready**. Press **Refresh**, or tap the notice to do it later. What you saved is kept.',
        '**Everything saves by itself.** There is no Save button on a task. "Saved" shows at the top of the task when it is done.',
      ],
    }],
  },
  {
    id: 'roles',
    title: 'People involved',
    parts: [{
      rows: [
        ['Admin', 'The highest role. Can use every tool, manage staff accounts and shared app settings, and change a task at any stage.'],
        ['Moderator', 'Day-to-day access across work orders, the print queue, and inventory, combining the workflow tools used by reception, artists, and operators. Cannot manage accounts or shared app settings.'],
        ['Receptionist', 'Creates work orders, fills in the items, adds files, chooses the printing area and assigns an artist. Checks the artist\'s file (**Send to print** or **Send back**). Can run the Print Queue like an operator. Checks printed jobs (**For Release**, **Released to Client**, or **Return** for a reprint).'],
        ['Artist', 'Works on the tasks assigned to them and attaches the artwork files. The task moves to **File Attached for Review** by itself.'],
        ['Printer operator (Office / Production)', 'Prints the jobs for their printing area from the **Print Queue**: Assign to me, set the status and timer, count the pages, mark each file printed, then **Finish**.'],
        ['Tech Developer / Support', 'Look after the app. They have the same full access as an Admin.'],
      ],
    }],
  },
  {
    id: 'screens',
    title: 'The screens',
    parts: [
      {
        rows: [
          ['Work Orders', 'The board. Every task, grouped by status. Search at the top, **Filters** beside it, **+ New work order** on the right. Click a task to open it.'],
          ['Workload', 'How many tasks each person has, the art done and the jobs printed. Admins also get the **Report** here (Monthly, Quarterly, Yearly or All time) as a PDF, a spreadsheet (CSV) or a print-out. Each closed year is kept in the **Yearly** Archive.'],
          ['Print Queue', 'The **Print Dashboard** shows Office and Production printer status plus live queue totals. Open **All Print** to manage jobs and filter by printing area.'],
          ['Admin Tools', 'Admins only. Add staff, change roles, switch accounts off. Admin is the highest role; Moderator is below Admin and has operational workflow access.'],
          ['Bell', 'Your notifications. Beside your profile on phones and at the bottom of the desktop sidebar.'],
          ['Chat', 'On desktop, choose **Chat** below Admin Tools. On phones, tap the floating chat button. Both open the same chat window.'],
          ['Your name (profile button)', 'Shows your status. Opens Set status, Help, Trash Bin and Sign out.'],
          ['What\'s new', 'A colored announcement above the current screen shows updates you have not seen. Press **Got it** to dismiss it or **See all updates** to open the full history.'],
          ['Settings gear', 'Beside the notification bell next to your profile. Choose **Light**, **Dark** or **System**, or open full Settings for notifications and sign-in security.'],
        ],
      },
      {
        heading: 'On the Work Orders board',
        list: [
          '**Search** finds a task by its WO number, customer, items, artist or material.',
          '**Filters** narrows the board by status, priority or due date.',
          'Click a column heading to sort by it. **Default order** puts it back: urgent first, then the nearest deadline, then the newest.',
          'The **Items** cell shows a short summary such as "3 items · 8 pcs". Hover over it, or tap it on a phone, to see the full list.',
          '**Drag a task** onto another status to move it, for example from In progress to Waiting to Print. Only moves you are allowed to make will work.',
          'Released jobs are archived by themselves after 90 days (about three months). Use **Show archived** to see them.',
        ],
      },
    ],
  },
  {
    id: 'statuses',
    title: 'Task statuses',
    intro: 'The status changes by itself as the work moves on. On tasks you may edit, the status label is also a button.',
    parts: [{
      rows: [
        ['To Do', 'A new task with no artist yet.'],
        ['In progress', 'An artist is working on it. This starts by itself when an artist is assigned.'],
        ['File Attached for Review', 'The artwork file is on the task. Waiting for admin or reception to check it.'],
        ['Waiting to Print', 'Approved and sent to print. It is in the Print Queue for the Office or Production operators.'],
        ['Done Printing', 'Printed. Waiting for reception or an admin to check the printed item.'],
        ['For Release', 'Checked and good. Waiting for the customer to collect it.'],
        ['Released to Client', 'Handed to the customer. The job is complete.'],
      ],
    }],
  },
  {
    id: 'job',
    title: 'A job, step by step',
    parts: [
      {
        heading: 'Creating a work order',
        steps: [
          { who: 'Admin / Receptionist', what: 'Press **+ New work order** and fill in the form.', details: [
            'The work order number is made for you. Change it if you number jobs differently.',
            'Type the **customer** and their phone number for pickup.',
            'List what the job is in the **Items** table.',
            'Add the material, laminating, priority and the due date.',
            'Choose the **printing area**: Office, Production, or Either.',
            'Under it, **Assigned to**: the operator who will print it (optional). Once the job is sent to print it is theirs in the Print Queue.',
            'Use **Note for the operator** for anything the printer operator must know.',
            'Add files if you already have them, and assign an artist if the job is ready.',
          ] },
          { who: 'Admin / Receptionist', what: 'Press **Add work order**. The form tells you which status it will save as.', details: [
            'No artist: it saves as **To Do**.',
            'An artist, no file: **In progress**. The artist is notified.',
            'An artist and a file: **File Attached for Review**.',
          ] },
        ],
        note: 'If you close the form before saving, what you typed is kept as a draft. Open **+ New work order** again to continue.',
      },
      {
        heading: 'Doing the artwork',
        steps: [
          { who: 'Artist', what: 'Open the task. It is under **In progress** as soon as you are assigned.', details: ['Opening a task assigned to you clears its notification.'] },
          { who: 'Artist', what: 'Attach the finished artwork file or files.', details: [
            'As soon as a file is on the task, it becomes **File Attached for Review** by itself.',
            'You can still add or remove files until the task is sent to print.',
          ] },
        ],
      },
      {
        heading: 'Waiting for the client',
        steps: [
          { who: 'Artist / Admin / Receptionist', what: 'The layout is done but the client has not approved it yet? Open the task and press **Mark as waiting for client approval**.', details: [
            'The status does not change. The task shows a **Client** tag on the board.',
            'While it is marked, the task is **not counted as late**.',
            'Each file the artist adds to the task counts toward their **Art done**, 1 credit each.',
          ] },
          { who: 'Artist / Admin / Receptionist', what: 'When the client says yes, press **Client approved**.', details: ['Sending the job to print clears the mark by itself.'] },
        ],
        note: 'The task needs an artist before it can be marked, and it cannot be marked once it has gone to print.',
      },
      {
        heading: 'Checking the file',
        steps: [
          { who: 'Admin / Receptionist', what: 'Open the task and check the file. Two buttons are at the top right.', details: [
            '**Send to print**: the job goes to the Print Queue of its printing area. Status: **Waiting to Print**.',
            '**Send back**: type what needs changing. The task returns to **In progress** and the artist gets your note.',
          ] },
        ],
      },
      {
        heading: 'Printing',
        steps: [
          { who: 'Printer operator (or reception)', what: 'Open the **Print Queue**, press **Assign to me**, and run the job.', details: [
            'When it is done press **Finish**. Status: **Done Printing**. Reception checks it next.',
          ] },
        ],
      },
      {
        heading: 'Releasing',
        steps: [
          { who: 'Admin / Receptionist', what: 'Check the printed item, then choose at the top right of the task.', details: [
            'Good: press **For Release**. It now waits for the customer.',
            'Needs a reprint: press **Return**, give the reason. It goes back to the operator (**Waiting to Print**).',
          ] },
          { who: 'Admin / Receptionist', what: 'When the customer has it, press **Released to Client**.', details: ['Pressed For Release by mistake? Use **Undo For Release**.'] },
        ],
      },
      {
        heading: 'Other things you can do on a task',
        list: [
          '**Comments** on the right side of the task: ask about the job there so the answer stays with it. Type **@** and a name to tag someone. They are notified.',
          '**History** (under the comments): every step of the task with the date and the person — who made it, who did the art, each send back, who printed it, each reprint, who released it. It is written by the system and cannot be edited.',
          '**Task settings** (top right): **Duplicate** makes a new task with the same details. **Move to Trash** removes the task; it can be brought back from the Trash Bin.',
        ],
      },
      {
        heading: 'Who gets the credit',
        list: [
          'Three people work on a job. Each is counted for their own part.',
          '**Made the task**: the person who created it.',
          '**Art done**: the artist gets 1 credit for each file they add to a task. Removing the file takes that credit back, and a task in the **Trash** does not count (restoring it brings its credits back).',
          '**Printed**: the operator who took the job in the Print Queue, even when reception or an admin marks it done for them. A job nobody took is credited to whoever pressed Finish.',
          'The **Workload** screen and the **Report** count the same way, each on the day the work was done.',
        ],
      },
    ],
  },
  {
    id: 'items',
    title: 'The Items table',
    intro: 'The Items table lists what the job is, one line per item. The total quantity is added up for you.',
    parts: [
      {
        rows: [
          ['Add an item', 'Type its name and quantity. Press **+ Add item** (or Enter on the last line) for the next one.'],
          ['Remove an item', 'Press the **x** at the end of its line.'],
          ['Per sheet', 'If several fit on one printed sheet, type how many, for example 12 icons on one sheet. The Print Queue then counts **sheets**: 120 icons at 12 per sheet = 10 sheets. Leave it blank for one per sheet.'],
          ['Installation', 'Choose **With Installation** or **Without Installation** on each line.'],
          ['Mark all', 'With two or more items, **Mark all…** sets every item to With or Without Installation in one go. It asks first.'],
          ['Add your own column', 'Press **+ Add column** and type its name, for example Branch or Size. Each task can have up to 6.'],
          ['Rename a column', 'Type in its heading.'],
          ['Remove a column', 'Press the **x** beside its heading. If something is typed in it, the app asks first.'],
        ],
      },
      {
        heading: 'Move a typed list into the table',
        list: [
          'If the **Job description** holds a typed list of items, for example "12 x 21ft tarpaulin - 1PC" or "Flyers = 150pcs" on separate lines, a note appears under it: **Found 8 items in the description**.',
          'Press **Move to Items table**. The names and quantities go into the table and the description is emptied.',
          'A line typed under an item that starts with a dash, such as "- JB Ecowest", goes into a **Details** column beside that item. You can rename that column.',
          'Check the items. If it is not what you wanted, press **Undo** straight away. Undo goes away once you edit the table.',
          'Nothing moves by itself. Older tasks stay as they are until someone opens them and presses the button.',
        ],
        note: 'What is typed in your own columns shows in the board\'s item list and in the Print Queue, as "Branch: JB Ecowest". The board search finds it too.',
      },
    ],
  },
  {
    id: 'files',
    title: 'Files',
    parts: [
      {
        heading: 'Adding files',
        list: [
          'Use **Choose files** (press it again to add more), drag and drop onto the task, **Pick from Drive**, or paste a link.',
          '**Paste Copied Image**: take a screenshot or snip (or copy a picture), then press this button beside Upload files. The picture is attached like any other file. Allow clipboard access if the browser asks.',
          'You can paste or type **several links at once**. If a link has words around it, only the link is kept.',
          '**Upload folder**: choose a whole folder and every file inside goes up. Each file keeps its folder\'s name, for example "400 x 304 with sintra". You can also drag folders onto the task.',
          'Use one folder for each size or material. The task and the Print Queue list the files under each folder\'s name, so the operator prints the right file on the right material.',
          'Choosing the whole job (one folder holding two or more folders) uses the inner folders\' names. A folder with one folder inside keeps both names, for example "500 x 304 / proofs". A task holds up to 30 files.',
          'If a file is over 200MB or cannot be read, the app names it and says what to do. If the connection drops half-way, the files already uploaded stay on the task and the message names the rest.',
          'Uploading again **adds** files. It never replaces the ones already there.',
          'The first upload on a computer or phone may show **Connect Google Drive & upload**. Press it once to sign in to the company Google Drive. The upload then continues.',
        ],
      },
      {
        heading: 'Viewing files',
        list: [
          'All files show in one preview. Use the arrows, or swipe on a phone. Press the picture to see it full screen.',
          'The file\'s link is under the preview with **Copy link**. With several files, **All links** lists every one.',
          'Most file types work: images, PDF, Word, Excel, PowerPoint, AI, PSD, CDR and more. PDFs and Office files show a preview.',
        ],
      },
      {
        heading: 'Removing files',
        list: [
          'Press **Remove** under a file. You are asked to confirm.',
          'The file leaves the task and goes to Google Drive\'s Trash, where it can be restored for 30 days. If another task uses the same file, it stays in Drive.',
          'Removing the last file of a task under File Attached for Review puts it back to **In progress**.',
          'After a task is sent to print, only an admin can change its files.',
        ],
      },
    ],
  },
  {
    id: 'queue',
    title: 'Print Queue',
    intro: 'For printer operators. Reception and admins can do everything here too.',
    parts: [
      {
        steps: [
          { who: 'Operator', what: 'Open **Print Queue**. The **Print Dashboard** shows Office and Production printer status. Choose **All Print** to see jobs; use its area filter for Office or Production.', details: ['New jobs arrive by themselves with a chime. Leave **All Print** open at the printing area to run the queue.'] },
          { who: 'Operator', what: 'Press **Assign to me** on the job, then unfold it.', details: [
            'Read the **Note for the operator** if there is one.',
            'Reception or an admin can also assign a job to an operator, or change who has it.',
          ] },
          { who: 'Operator', what: 'Set the **current status**: Waiting, Preparing, Printing or On pause.', details: [
            'Type the hours, minutes and seconds and press **Set timer**. Putting the job On pause pauses the timer.',
            'When the time is up the app sounds an alarm.',
          ] },
          { who: 'Operator', what: 'Open or download each file, print it, then press **Mark printed** on it.', details: [
            'A file turns blue with **Opened** once someone opens or downloads it.',
            'It turns green with **Printed** when marked, and shows who and when.',
            'Everyone sees the same marks. If the job is returned for a reprint, the Printed marks clear.',
          ] },
          { who: 'Operator', what: 'Count the pages under **Page printed** with the arrows, or press **Set pages**.', details: ['Each item shows its details, for example "Branch: JB Ecowest".', 'An item printed several to a sheet counts **sheets**: 120 icons at 12 per sheet = 10.'] },
          { who: 'Operator', what: 'When every file is printed, press **Finish**.', details: [
            'The status becomes **Done Printing**. Reception checks the printed item next.',
            'If reception presses Finish, the print is still counted for the operator assigned to the job.',
          ] },
        ],
      },
      {
        heading: 'If something goes wrong',
        list: [
          'Press **Report a problem** and choose: Wrong item to print, Broken print, Broken printer, or Other problem. The timer pauses, and the problem shows on the job for everyone.',
          'Press **Problem solved** when it is fixed.',
          'At the top right, each printing area\'s printer shows **Working**, **Cooling down** or **Broken**. Tap it to change it. Marking it Broken, and working again, notifies everyone. A cool-down counts down and ends by itself.',
          'The star marks a job as a priority so it is done first.',
        ],
      },
    ],
  },
  {
    id: 'chat',
    title: 'Chat',
    intro: 'Chat is for everything that is not about one job. For a question about a job, use the comments on its task.',
    parts: [
      {
        rows: [
          ['Open your chats', 'On desktop, select **Chat** below Admin Tools. On a phone, tap the floating chat button. A red number shows unread messages and chats you were just added to.'],
          ['Message someone', 'Press the pencil at the top, or search a name.'],
          ['Make a group', 'Press the add-people button at the top, pick the people and name the group.'],
          ['Tag someone', 'Type **@** and choose a name. They get a "mentioned you" notification.'],
          ['Tag the whole group', 'In a group chat type **@everyone** (or pick it from the list). Everyone in the group gets a "mentioned you" notification.'],
          ['Tag a whole role', 'Type **@artists**, **@operators**, **@reception** or **@admins** (or pick it from the list). In a task\'s comments it reaches everyone with that role; in a group chat, the group\'s members with that role.'],
          ['Send a picture', 'Tap the **picture button** beside the typing box and choose one or more pictures, or paste a copied screenshot into the typing box (Ctrl+V). Tap a picture in the chat to see it full screen. Only the people in that chat can open it.'],
          ['React to a message', 'Press and hold it, or press the smiley button beside it, and pick an emoji. You have one reaction per message: pick another to change it, or the same one to take it off. Tap the small emoji on a message to see who reacted.'],
          ['See when it was sent, and who has seen it', 'Tap the message. It shows the time and **Seen by** with the names. A small picture of each person also sits under the last message they have seen. **Sent** means nobody has opened it yet.'],
          ['Group settings', 'In a group, press the settings button at the top to rename it, or add and remove people.'],
        ],
      },
      {
        heading: 'Online, Offline and status',
        list: [
          'A **green** dot means the person is **Online**: they have the app open now. A **red** dot means **Offline**.',
          '**Working** shows only while the person is online. **Out of office** and **Sick** always show, so you know why someone may not answer.',
          'The top of an open chat shows the other person\'s status.',
        ],
      },
      {
        heading: 'Archive or delete a chat',
        list: [
          'Each chat in the list has a **three-dot button** at the end. Press it for **Archive chat** and **Delete chat**.',
          '**Archive chat** moves it under **Archived chats** at the bottom of the list. It comes back by itself when a new message arrives, or press the three dots and **Unarchive chat**.',
          '**Delete chat** removes the whole history on **your side only**, for good. The other person keeps their copy. The app asks before it deletes.',
          'If that person messages you again, the chat returns with only the new messages. The old ones do not come back.',
        ],
        note: 'Delete chat cannot be undone. If you only want a chat out of the way, use Archive.',
      },
    ],
  },
  {
    id: 'notifications',
    title: 'Notifications',
    parts: [
      {
        list: [
          'The **bell** shows what needs you: a task assigned to you, a print job assigned to you, a chat message, or a mention in a chat or a task comment.',
          'Press a notification to open the task or chat it is about.',
          'Notifications **clear themselves** once you have seen the thing: opening the chat, reading the task\'s comments, or opening a task assigned to you.',
          '**Mark all read** and **Clear all** are at the top of the list. **Escape** closes it.',
          'A chat is marked read only when you really have it open in front of you.',
        ],
      },
      {
        heading: 'Alerts on your phone',
        list: [
          'Open **Settings** from your profile button and turn on **Push notifications** on that phone or computer.',
          'Alerts then reach you even when the app is closed. This matters most for artists and printer operators, so they know when a job is assigned to them.',
        ],
      },
    ],
  },
  {
    id: 'status',
    title: 'Your status',
    parts: [{
      list: [
        'Press your name, then **Set status**: **Working**, **Out of office** or **Sick**.',
        'You can add a short note, for example "Bank errand", and when you will be back. The status returns to Working by itself at that time.',
        'Your status shows on your profile button, in chat, and beside your name where tasks are assigned.',
        'Someone who is Out of office or Sick can still be assigned a task. The app shows their status so you can decide.',
      ],
    }],
  },
  {
    id: 'account',
    title: 'Your account',
    parts: [{
      rows: [
        ['Password', 'Chosen by you at your first sign-in. If you forget it, ask an admin for a new temporary one.'],
        ['Password recovery email', 'In **Settings**. Press **Add recovery email** (or **Change**), type the email and your **current password**. Five wrong passwords lock it for 15 minutes.'],
        ['Two-factor authentication', 'In **Settings**. Adds a code from an authenticator app when you sign in. A device you trust is not asked again for 30 days.'],
        ['Appearance', 'Open the **Settings** gear beside the update announcement and choose **Light**, **Dark** or **System** to follow your device.'],
        ['Notifications', 'In **Settings**. Mute or unmute the sounds, and turn on push notifications.'],
        ['Trash Bin', 'From the profile button. Tasks moved to Trash can be brought back from here. Only an admin can delete one for good.'],
        ['Admin Tools', 'Admins only. Add a staff member with a username and a temporary password, change a role, set an operator\'s printing area, or switch an account off.'],
        ['What\'s new', 'A colored announcement appears above the current screen when there are unseen updates. Press **See all updates** to browse the full history.'],
        ['Help', 'From the profile button. The **User Manual** and **Chat Support**.'],
      ],
    }],
  },
  {
    id: 'help',
    title: 'Help and Chat Support',
    intro: 'Press your name (profile button), then **Help**.',
    parts: [
      {
        rows: [
          ['User Manual', 'This manual, inside the app. Use **Search the manual** to find a word, or **Print**.'],
          ['Chat Support', 'Type a question, or tap one of the suggested questions. The helper answers at once with the steps.'],
        ],
      },
      {
        heading: 'Using Chat Support',
        list: [
          'Ask in your own words, in English or Filipino, for example "paano mag upload ng file" or "how to release".',
          'If it is not sure, it shows a few close questions. Tap the one you meant.',
          'After an answer it asks **Did that solve it?** Tap **Yes, all good** or **No, still stuck**.',
          'When everything is good, press **Close ticket**. That ends the conversation.',
          'Need a person? Type or tap **Talk to a person**. It also offers this by itself when it could not help twice. It then adds Support to a group chat with you, with what you asked so far.',
          'It keeps working when the internet drops, as long as the page stays open. Refreshing the page starts a new conversation.',
        ],
        note: 'The helper only knows how the tracker works. For a question about a job, use the comments on its task.',
      },
    ],
  },
  {
    id: 'reminders',
    title: 'Quick reminders',
    parts: [{
      list: [
        'Everything saves by itself. There is no Save button on a task.',
        'Always give the work order number (for example WO-36484) when talking about a job.',
        'Put items in the **Items table**, not in the description. Use **Move to Items table** when a list was typed in the description.',
        'Choose the printing area on every job. It decides which operators get it.',
        'Uploading more files adds to the task. It never replaces files.',
        'Only admin and reception can send a task to print and release it.',
        'Operators: mark each file **Printed**, then press **Finish**.',
        'Use the task\'s **comments** for questions about a job, and **chat** for everything else.',
        'Set your status when you are Out of office or Sick.',
        'Press **Refresh** when the app says a new version is ready.',
        'Layout done, client not answering? Mark the task **waiting for client approval** so it is not counted as late.',
      ],
    }],
  },
];

/** Every sentence of a section as plain text (no ** marks) — for searching. */
export function sectionText(s: ManualSection): string {
  const out: string[] = [s.title, s.intro ?? ''];
  for (const p of s.parts) {
    if (p.heading) out.push(p.heading);
    if (p.list) out.push(...p.list);
    if (p.rows) for (const [a, b] of p.rows) out.push(a, b);
    if (p.steps) for (const st of p.steps) out.push(st.who, st.what, ...(st.details ?? []));
    if (p.note) out.push(p.note);
  }
  return out.join(' \n').replace(/\*\*/g, '');
}
