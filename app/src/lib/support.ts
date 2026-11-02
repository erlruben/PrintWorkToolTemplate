/**
 * Chat Support (2026-10-11): a scripted helper that knows how the tracker
 * works. Everything here runs in the browser — no AI service, no network — so
 * it keeps answering when the internet drops, for as long as the page stays
 * open. It answers from the topics below (written from the user manual), asks
 * whether that solved it, and offers a real person (Support) when asked, or
 * when it could not answer twice in a row.
 */
import type { Role } from './types';

export interface SupportTopic {
  id: string;
  /** The question as a person would ask it — also shown as a suggestion. */
  title: string;
  /** Words and phrases that point to this topic (lower-case; English and Filipino). */
  keys: string[];
  /** The answer: short steps. **bold** marks buttons and names. */
  answer: string[];
  /** Topics worth offering after this one. */
  related?: string[];
  /** Shown first to these roles. */
  roles?: Role[];
}

export const SUPPORT_TOPICS: SupportTopic[] = [
  {
    id: 'new-order', title: 'How do I create a work order?', roles: ['receptionist', 'admin'],
    keys: ['create', 'new work order', 'new task', 'add work order', 'make a task', 'new job', 'gawa', 'paggawa', 'bagong task', 'add task', 'encode', 'job order', 'new order', 'customer order', 'make a job', 'add a new job', 'encode a new', 'work order form', 'input order', 'walk in', 'walk-in', 'enter an order', 'new customer', 'start a new task', 'enter a new', 'bagong order', 'new client', 'add ng bagong order', 'where do i start'],
    answer: [
      'On **Work Orders**, press **+ New work order** (top right).',
      'Type the customer, list the job in the **Items** table, then the material, priority and due date.',
      'Choose the **printing area** (Office, Production or Either) and, under it, who will print it (**Assigned to**). Assign an artist if the job is ready.',
      'Press **Add work order**. The form tells you which status it will save as.',
    ],
    related: ['items', 'status-meaning', 'draft'],
  },
  {
    id: 'draft', title: 'I closed the form. Is what I typed lost?',
    keys: ['draft', 'closed the form', 'lost what i typed', 'nawala', 'unsaved', 'accidentally closed', 'continue typing', 'what i typed', 'closed the window', 'form closed'],
    answer: [
      'No. A new work order you did not finish is kept as a **draft**.',
      'Press **+ New work order** again and it opens with what you typed.',
      'On an existing task everything saves by itself. Look for **Saved** at the top of the task.',
    ],
    related: ['save'],
  },
  {
    id: 'save', title: 'Where is the Save button?',
    keys: ['save button', 'how to save', 'not saving', 'did it save', 'autosave', 'auto save', 'i-save', 'paano mag save', 'saving', 'did not save', 'didnt save', 'is it saved', 'change saved', 'saved', 'wont save', 'save my changes', 'na-save', 'edits are gone', 'my edits', 'changes are gone', 'press save', 'need to save', 'changes lost', 'na save', 'kung na save', 'di ko alam kung na save'],
    answer: [
      'There is no Save button on a task. **Everything saves by itself** about a second after you stop typing.',
      'The top of the task shows **Saving…** and then **Saved**.',
      'If it says it could not save, check your internet and keep the task open. It tries again.',
    ],
  },
  {
    id: 'items', title: 'How do I list the items of a job?',
    keys: ['items', 'item table', 'add item', 'quantity', 'qty', 'installation', 'mark all', 'with installation', 'without installation', 'pcs', 'add another item', 'another item', 'more items', 'item name', 'how many pieces', 'put quantity', 'set installation', 'total quantity', 'remove an item', 'several products', 'products', 'list products', 'how many pcs', 'pieces', 'more than one item', 'different products', 'quantity ng', 'bawat item', 'five different'],
    answer: [
      'In the **Items** table type the item name and its quantity. Press **+ Add item** for the next one.',
      'Choose **With Installation** or **Without Installation** on each line.',
      'With two or more items, **Mark all…** sets every line at once. It asks first.',
      'The total is added up for you. Several on one printed sheet (like 12 icons)? Type it under **Per sheet**.',
    ],
    related: ['per-sheet', 'columns', 'move-items'],
  },
  {
    id: 'per-sheet', title: 'Several pieces fit on one sheet. How do I set that?',
    keys: ['per sheet', 'sheet', 'sheets', 'one sheet', 'on one sheet', 'icons on one sheet', 'icons per sheet', 'how many per sheet', 'up', '12 up', 'layout on a sheet', 'imposition', 'pieces per page', 'per page', 'isang sheet', 'isang page', 'ilan sa isang page', 'pages to print', 'how many pages', 'sheets to print', 'count sheets'],
    answer: [
      'In the **Items** table type the quantity (for example 120 icons) and, under **Per sheet**, how many fit on one sheet (12).',
      'The table shows **Total: 120 pcs · 10 sheets**. The Print Queue counts **sheets** for that item: 0/10.',
      'You can also type it in the description, like "Icons = 120pcs - 12 per sheet", then **Move to Items table**.',
      'Leave Per sheet blank when each piece is its own sheet.',
    ],
    related: ['items', 'queue'],
  },
  {
    id: 'columns', title: 'How do I add my own column to the Items table?',
    keys: ['column', 'add column', 'rename column', 'remove column', 'branch', 'size column', 'details column', 'custom column', 'new column', 'more columns', 'add columns', 'delete a column', 'extra column', 'another column', 'columns', 'column for', 'name of a column', 'column name', 'store branch', 'per item', 'address per item', 'delivery address', 'extra info per item'],
    answer: [
      'In the Items table press **+ Add column** and type its name, for example Branch or Size.',
      'To rename it, type in its heading. To remove it, press the **x** beside the heading.',
      'Each task can have up to **6** of its own columns.',
      'What you type there shows in the board\'s item list and in the Print Queue.',
    ],
    related: ['items', 'move-items'],
  },
  {
    id: 'move-items', title: 'The items were typed in the description. How do I move them?',
    keys: ['move to items', 'description', 'job description', 'found items', 'typed list', 'list in description', 'undo move', 'items in description', 'typed everything in the description', 'description box', 'in the description', 'everything in description', 'wrong box', 'items is in the wrong', 'list of items is in'],
    answer: [
      'Open the task. Under **Job description** a note says **Found … items in the description**.',
      'Press **Move to Items table**. The names and quantities go into the table.',
      'A line under an item that starts with a dash (for example "- JB Ecowest") goes into a **Details** column.',
      'Not what you wanted? Press **Undo** right away. Undo goes away once you edit the table.',
    ],
    related: ['items', 'columns'],
  },
  {
    id: 'assign', title: 'How do I assign or change the artist?', roles: ['receptionist', 'admin'],
    keys: ['assign', 'artist', 'reassign', 'change artist', 'who is assigned', 'i-assign', 'bigay sa artist', 'unassigned', 'give the task', 'give to', 'not in the list', 'who should i assign', 'pick an artist', 'designer', 'ibigay', 'which artist', 'should get this job', 'transfer the task', 'transfer to', 'another artist', 'pass the task', 'hand the task', 'sino ang artist', 'another designer', 'hand this to', 'artist ng task'],
    answer: [
      'Open the task and choose a name under **Artist** (on a new work order: **Assign to artist**).',
      'The task moves to **In progress** by itself and the artist is notified.',
      'The list shows each person\'s status, so you can see who is Out of office or Sick.',
    ],
    related: ['status-meaning', 'notifications'],
  },
  {
    id: 'status-meaning', title: 'What does each status mean?',
    keys: ['status', 'statuses', 'what does', 'meaning', 'to do', 'in progress', 'file attached', 'for review', 'waiting to print', 'done printing', 'for release', 'released', 'ibig sabihin', 'what is waiting to print', 'what is done printing', 'what is for release', 'what is in progress', 'what is to do', 'status mean', 'meaning of the status', 'difference between', 'what is the difference'],
    answer: [
      '**To Do**: new, no artist yet. **In progress**: an artist is working on it.',
      '**File Attached for Review**: the artwork is on the task; admin or reception checks it.',
      '**Waiting to Print**: sent to the Print Queue. **Done Printing**: printed; reception checks the item.',
      '**For Release**: checked, waiting for the customer. **Released to Client**: handed over, complete.',
    ],
    related: ['change-status', 'send-to-print'],
  },
  {
    id: 'change-status', title: 'How do I change a task\'s status?',
    keys: ['change status', 'move task', 'drag', 'cannot move', 'cant move', 'status button', 'move to', 'ilipat', 'di ma-move', 'wont move', 'set to in progress', 'set status of task', 'change the status', 'will not move', 'move it to', 'put it back to', 'mark as in progress', 'status of a task', 'dragging', 'drag the card', 'card does nothing', 'does nothing', 'cannot change status', 'status wont change', 'status is stuck', 'stuck on in progress', 'stuck on', 'status not changing'],
    answer: [
      'Most statuses change **by themselves**: assigning an artist, attaching a file, Send to print, Finish, For Release.',
      'On the board you can also **drag a task** onto another status.',
      'A move only works if your role may do it. An artist can only move a task between To Do and In progress.',
      'If it will not move, open the task and use the button at the top right instead.',
    ],
    related: ['status-meaning', 'send-to-print'],
  },
  {
    id: 'files', title: 'How do I attach a file?',
    keys: ['attach', 'upload', 'file', 'files', 'add file', 'drive', 'pick from drive', 'paste link', 'link', 'artwork', 'i-upload', 'ilagay ang file', 'choose files', 'put the artwork', 'add the design', 'the design', 'add link', 'add a link', 'layout', 'attach the design', 'send the file', 'print file', 'where do i put', 'finished design', 'send my design', 'send my finished', 'submit my design', 'submit the artwork', 'drive link', 'link instead of uploading', 'final artwork', 'tapos na ang design', 'saan ko ilalagay', 'attach two files', 'two files', 'ilagay ang design'],
    answer: [
      'Open the task. Use **Choose files**, drag and drop, **Pick from Drive**, or paste a link.',
      'You can add several files, and paste several links at once. Uploading again **adds** files, it never replaces them.',
      'As soon as a file is on the task it becomes **File Attached for Review** by itself.',
    ],
    related: ['drive-connect', 'remove-file', 'file-types'],
  },
  {
    id: 'upload-folder', title: 'How do I upload a whole folder of files?',
    keys: ['folder', 'folders', 'upload folder', 'upload a folder', 'whole folder', 'naka folder', 'nakafolder', 'files in folders', 'by folder', 'per folder', 'each folder', 'separate folders', 'group the files', 'grouped files', 'different sizes', 'per size', 'per material', 'which file is for which', 'operator confused', 'malito ang operator', 'hindi malito', 'drag a folder', 'drop a folder', 'subfolder', 'sub folder'],
    answer: [
      'Open the task and press **Upload folder** (beside Upload files), then choose the folder. Every file inside goes up.',
      'Each file keeps its **folder\'s name**. Use one folder per size or material, for example "400 x 304 with sintra".',
      'The task and the **Print Queue** list the files under each folder, so the operator knows which file is for which.',
      'You can also drag folders onto the task. A task holds up to 30 files. On a phone, upload the files instead.',
    ],
    related: ['files', 'queue', 'file-marks'],
  },
  {
    id: 'drive-connect', title: 'It says "Connect Google Drive & upload". What do I do?',
    keys: ['connect google drive', 'google', 'sign in to google', 'drive sign in', 'upload failed', 'cannot upload', 'cant upload', 'upload not working', 'upload error', 'ayaw mag upload', 'drive not working', 'popup blocked', 'asking me to sign in', 'sign in keeps', 'keeps popping', 'upload is stuck', 'upload stuck', 'stuck uploading', 'too big', 'file too big', 'large file', 'too large', 'upload fails', 'failed to upload', 'google account', 'pop up', 'popup', 'sign in with google', 'keeps failing', 'upload keeps', 'upload fail', 'uploading says', 'cannot connect to drive', 'drive error', 'error when uploading', 'popup closes', 'closes by itself', 'drive popup'],
    answer: [
      'Press **Connect Google Drive & upload** once and sign in with the **company Google account**. The upload then continues.',
      'If nothing opens, your browser blocked the pop-up. Allow pop-ups for this site and press it again.',
      'A very large file (over 200 MB): put it in the shared Drive folder yourself, then paste its link on the task.',
      'Still not working? Ask for a person below and tell them the work order number.',
    ],
    related: ['files'],
  },
  {
    id: 'paste-image', title: 'How do I attach a screenshot or a copied image?',
    keys: ['screenshot', 'screen shot', 'snip', 'snipping', 'snipped', 'paste image', 'paste copied image', 'copied image', 'paste a picture', 'paste picture', 'paste the image', 'ctrl v', 'clipboard', 'print screen', 'capture'],
    answer: [
      'Take the screenshot or snip (or copy a picture) so it is on your clipboard.',
      'Open the task and press **Paste Copied Image**, beside **Upload files**.',
      'If the browser asks to see your clipboard, press Allow. The picture is attached like any other file.',
      'Nothing happens? Copy the image again, then press the button. On some phones, save the picture and use **Upload files** instead.',
    ],
    related: ['files', 'drive-connect'],
  },
  {
    id: 'file-types', title: 'Which file types can I upload?',
    keys: ['file type', 'file types', 'format', 'pdf', 'psd', 'cdr', 'cdr file', 'psd file', 'pdf file', 'ai file', 'corel', 'photoshop', 'preview', 'cannot preview', 'no preview', 'can i upload a', 'what files', 'accept', 'accepts', 'corel files', 'what kind of file', 'kind of files', 'supported', 'see the preview', 'cant see the preview', 'thumbnail', 'photoshop file', 'illustrator', 'file ok', 'allowed files', 'jpeg', 'jpg', 'png', 'excel file', 'word file', 'attach an excel', 'powerpoint'],
    answer: [
      'Most types work: images, PDF, Word, Excel, PowerPoint, AI, PSD, CDR and more.',
      'Images, PDFs and Office files show a **preview**. Other types show their name and a link.',
      'Press the picture to see it full screen. Use the arrows, or swipe on a phone, for the next file.',
    ],
    related: ['files'],
  },
  {
    id: 'remove-file', title: 'How do I remove a wrong file?',
    keys: ['remove file', 'delete file', 'wrong file', 'replace file', 'change file', 'tanggalin ang file', 'maling file', 'delete the attached', 'attached file', 'replace the file', 'take out the file', 'remove the wrong', 'remove attachment', 'delete attachment', 'wrong version', 'uploaded the wrong', 'old version', 'outdated file', 'swap the file', 'mali ang na upload', 'na upload ko', 'mali ang file'],
    answer: [
      'Under the file press **Remove** and confirm.',
      'It leaves the task and goes to Google Drive\'s Trash, where it can be restored for 30 days.',
      'Then add the right file. After a task is sent to print, only an admin can change its files.',
    ],
    related: ['files'],
  },
  {
    id: 'send-to-print', title: 'How do I send a task to print, or send it back?', roles: ['receptionist', 'admin'],
    keys: ['send to print', 'send back', 'approve', 'review file', 'check file', 'return to artist', 'revision', 'ipa-print', 'ibalik sa artist', 'for printing', 'approve the artwork', 'approved', 'forward it to printing', 'forward to printing', 'design is wrong', 'artwork is wrong', 'needs changes', 'ask for changes', 'reject', 'not approved', 'send it to the printer', 'ready to print', 'looks good', 'proceed to printing', 'proceed to print', 'fix the layout', 'artist to fix', 'make changes to the design', 'revise', 'ok to print', 'go ahead and print', 'change in the design', 'wants a change', 'ok the design', 'ok the artwork'],
    answer: [
      'Open a task under **File Attached for Review** and check the file.',
      '**Send to print** (top right) puts it in the Print Queue of its printing area.',
      '**Send back**: type what needs changing. It returns to **In progress** and the artist gets your note.',
      'Only admin and reception can send a task to print.',
    ],
    related: ['queue', 'release'],
  },
  {
    id: 'queue', title: 'How do I print a job from the Print Queue?', roles: ['operator', 'receptionist'],
    keys: ['print queue', 'queue', 'assign to me', 'printing', 'operator', 'finish', 'mark printed', 'timer', 'set timer', 'pages', 'page printed', 'set pages', 'preparing', 'on pause', 'take over', 'i-print', 'finish a print job', 'print job', 'count pages', 'pause printing', 'take over a job', 'start printing', 'my printing jobs', 'jobs to print', 'what to print', 'start printing', 'jobs waiting for me', 'waiting for me to print', 'what do i press when', 'my queue', 'begin printing', 'how many i printed', 'record how many', 'what do i do first', 'i am the operator'],
    answer: [
      'Open **Print Queue** and press **Assign to me** on the job, then unfold it.',
      'Set the status (**Preparing**, **Printing**, **On pause**) and, if you like, type the hours, minutes and seconds and press **Set timer**.',
      'Open or download each file, print it, then press **Mark printed** on it. Count the pages under **Page printed**.',
      'When every file is printed press **Finish**. The job becomes **Done Printing**.',
    ],
    related: ['problem', 'file-marks'],
  },
  {
    id: 'file-marks', title: 'What do the blue and green files in the queue mean?',
    keys: ['blue', 'green', 'opened', 'printed mark', 'highlight', 'highlighted', 'file color', 'file blue', 'file green', 'turns blue', 'turns green', 'kulay', 'of 3 printed', 'one file green', 'opened mean', 'what does opened', 'what does printed mean', 'marked printed', 'color of the file', 'files are highlighted', 'highlighted in the queue', 'colored files', 'file marks', 'blue label', 'label on a file', 'green label'],
    answer: [
      '**Blue – Opened**: someone has opened or downloaded that file.',
      '**Green – Printed**: someone pressed **Mark printed** on it. It shows who and when.',
      'Everyone sees the same marks. If the job is returned for a reprint, the Printed marks clear.',
    ],
    related: ['queue'],
  },
  {
    id: 'problem', title: 'The printer broke or the print is wrong. What do I do?', roles: ['operator'],
    keys: ['problem', 'report a problem', 'broken', 'printer down', 'sira', 'nasira', 'wrong item', 'broken print', 'misprint', 'problem solved', 'mali ang print', 'paper jam', 'jam', 'printer not working', 'printer is not working', 'was printed wrong', 'wrong item was printed', 'clear the problem', 'out of ink', 'no ink', 'machine', 'printer problem', 'printer stopped', 'stopped printing', 'ink ran out', 'ran out of ink', 'ran out', 'no more ink', 'printer error', 'printer wont print', 'defective printer', 'not printing properly', 'machine is not printing', 'printer issue'],
    answer: [
      'On the job in the Print Queue press **Report a problem**.',
      'Choose: Wrong item to print, Broken print, Broken printer, or Other problem. The timer pauses.',
      'The problem shows on the job for everyone. Press **Problem solved** when it is fixed.',
      'If the printer itself is down, also mark it **Broken** at the top right of the Print Queue, so everyone is told.',
    ],
    related: ['printer-status', 'queue'],
  },
  {
    id: 'printer-status', title: 'The printer is broken or cooling down. How do I tell everyone?', roles: ['operator', 'receptionist', 'admin'],
    keys: ['printer status', 'printer broken', 'broken printer', 'printer is broken', 'cooldown', 'cool down', 'cooling down', 'printer cooling', 'printer resting', 'printer down', 'machine broken', 'machine down', 'sira ang printer', 'sira printer', 'nasira ang printer', 'pahinga ang printer', 'printer working again', 'printer fixed', 'working again', 'top right', 'upper right'],
    answer: [
      'On the **Print Queue**, at the top right, tap the printer of your area (Office or Production).',
      'Choose **Broken…** and say what is wrong, then **Mark broken**. Everyone is notified, and tasks for that area show it.',
      'Choose **Cooling down…**, type the hours, minutes and seconds, and press **Start**. It counts down and turns back to Working by itself.',
      'When it is fixed, choose **Working**. Everyone is told it works again.',
    ],
    related: ['problem', 'queue'],
  },
  {
    id: 'release', title: 'How do I release a printed job, or return it for a reprint?', roles: ['receptionist', 'admin'],
    keys: ['release', 'for release', 'released to client', 'pickup', 'pick up', 'customer got it', 'reprint', 'return', 'return for reprint', 'undo for release', 'i-release', 'kinuha na', 'picked up', 'customer picked', 'claimed', 'mark as released', 'mark released', 'return the print', 'return to operator', 'ipa reprint', 'give to customer', 'hand over', 'ready for pickup', 'for pickup', 'already got their order', 'client got', 'got their order', 'has a defect', 'defect', 'send it back to print', 'print it again', 'customer received', 'delivered', 'print quality', 'quality is bad', 'need to redo', 'redo', 'here to claim', 'to claim', 'claim'],
    answer: [
      'Open the task under **Done Printing** and check the printed item.',
      'Good: press **For Release**. When the customer has it, press **Released to Client**.',
      'Needs a reprint: press **Return** and give the reason. It goes back to the operator.',
      'Pressed For Release by mistake? Use **Undo For Release**.',
    ],
    related: ['status-meaning', 'archive-task'],
  },
  {
    id: 'find', title: 'How do I find a task?',
    keys: ['find', 'search', 'look for', 'where is my task', 'cannot find', 'cant find', 'missing task', 'hanapin', 'nasaan', 'filter', 'filters', 'sort', 'default order', 'di makita', 'where is wo', 'wo number', 'filter by', 'sort by', 'look up', 'by priority', 'by due date', 'search for', 'locate', 'cannot locate', 'show only', 'only urgent', 'urgent tasks', 'tasks due today', 'only my tasks', 'hindi ko makita', 'makita ang work order', 'my tasks only'],
    answer: [
      'Type in **Search** at the top of Work Orders: the WO number, customer, an item, the artist or the material.',
      '**Filters** narrows by status, priority or due date. Check that no filter is hiding it.',
      'Released more than 30 days ago? Press **Show archived**. Deleted? Look in the **Trash Bin** (profile button).',
    ],
    related: ['archive-task', 'trash'],
  },
  {
    id: 'archive-task', title: 'Where did a released task go?',
    keys: ['archived', 'show archived', 'old task', 'disappeared', 'gone from board', 'nawala ang task', 'released task missing', 'unarchive task', 'old tasks', 'tasks disappeared', 'released jobs', 'where are the released', 'finished jobs gone', 'archive', 'released last month', 'last month', 'job is missing', 'older jobs', 'finished jobs go', 'where do finished', 'completed jobs'],
    answer: [
      'Released jobs are **archived by themselves after 30 days** to keep the board tidy.',
      'On Work Orders press **Show archived** to see them. Search finds them too once shown.',
    ],
    related: ['find', 'trash'],
  },
  {
    id: 'trash', title: 'I deleted a task by mistake. Can I get it back?',
    keys: ['trash', 'trash bin', 'deleted', 'restore', 'recover task', 'delete task', 'move to trash', 'na-delete', 'nabura', 'ibalik', 'delete a task', 'remove a task', 'delete work order', 'recover deleted', 'deleted work order', 'bring back a task', 'undelete', 'trashed', 'trashed the wrong', 'removed the wrong task', 'accidentally deleted', 'na delete ko', 'maling task', 'delete ko ang'],
    answer: [
      'Yes. Press your name (profile button) and open **Trash Bin**.',
      'Find the task and press **Restore**. It returns to the board as it was.',
      'A task stays in the Trash for 30 days. Only an admin can delete one for good.',
    ],
    related: ['find'],
  },
  {
    id: 'duplicate', title: 'How do I copy a task?',
    keys: ['duplicate', 'copy task', 'same job again', 'repeat order', 'clone', 'kopyahin', 'make a copy', 'copy of this task', 'copy this task', 'copy a task', 'same as before', 'reuse a task', 'same order as', 'how to reuse', 'reuse', 'order again', 'repeat a job', 'same thing as last time', 'as last time', 'same as last', 'same thing again'],
    answer: [
      'Open the task, press **Task settings** (top right), then **Duplicate**.',
      'A new work order form opens with the same details. Change what is different and press **Add work order**.',
    ],
  },
  {
    id: 'comments', title: 'How do I ask about a job or tag someone?',
    keys: ['comment', 'comments', 'tag', 'mention', '@', 'ask about a job', 'note on task', 'i-tag', 'mention someone', 'write a note', 'note about the job', 'leave a note', 'ask the artist', 'reply on the task', 'comment on', 'leave a message on the job', 'message on the job', 'message on the task', 'note for the artist', 'talk about the job', 'question for the artist', 'question about this job', 'ask about this job'],
    answer: [
      'Open the task. **Comments** are on the right (below the details on a phone).',
      'Type your question and press **Send**. Type **@** and pick a name to tag someone; they are notified.',
      'Use comments for anything about that job, so the answer stays with it.',
    ],
    related: ['chat', 'notifications'],
  },
  {
    id: 'chat', title: 'How do I message someone or make a group?',
    keys: ['chat', 'message', 'messages', 'group chat', 'new group', 'everyone', 'tag everyone', 'tag all', 'mention everyone', 'tag the group', 'dm', 'send message', 'react', 'reaction', 'mag-chat', 'mensahe', 'start a group', 'create a group', 'react to a message', 'send a message', 'message someone', 'pm', 'private message', 'new chat', 'chat with', 'how do i dm', 'chat for the', 'team chat', 'create a chat', 'direct message', 'chat with the', 'talk to the receptionist', 'message the'],
    answer: [
      'Press the round **chat button** in the corner.',
      'Press the **pencil** to message one person, or the **add-people** button to make a group.',
      'Type **@** to tag someone, or **@everyone** in a group to tag the whole group. Press and hold a message (or the smiley beside it) to react.',
    ],
    related: ['online', 'chat-archive', 'comments'],
  },
  {
    id: 'online', title: 'What do the green and red dots in chat mean?',
    keys: ['online', 'offline', 'green dot', 'red dot', 'active', 'inactive', 'working tag', 'dot', 'who is online', 'is online', 'the dot', 'is he online', 'available now', 'using the app right now', 'is someone online', 'who is active', 'is anyone online', 'pula ang bilog', 'bilog', 'berde', 'pula', 'red circle', 'green circle'],
    answer: [
      '**Green = Online**: the person has the app open now. **Red = Offline**.',
      '**Working** shows only while they are online. **Out of office** and **Sick** always show.',
    ],
    related: ['my-status', 'chat'],
  },
  {
    id: 'chat-picture', title: 'How do I send a picture in chat?',
    keys: ['send a picture', 'send picture', 'send photo', 'send a photo', 'send image', 'send an image', 'picture in chat', 'photo in chat', 'image in chat', 'attach picture in chat', 'send screenshot in chat', 'magpadala ng picture', 'mag send ng picture', 'picture sa chat'],
    answer: [
      'Open the chat and tap the **picture button** beside the typing box. Choose one or more pictures.',
      'Or copy a screenshot and paste it into the typing box (Ctrl+V).',
      'Tap a picture in the chat to see it full screen. Only the people in that chat can open it.',
    ],
    related: ['chat', 'paste-image'],
  },
  {
    id: 'chat-react', title: 'How do I react to a message?',
    keys: ['react', 'reaction', 'reactions', 'emoji', 'heart', 'like a message', 'thumbs up', 'who reacted', 'remove my reaction', 'change my reaction', 'mag react', 'haha react'],
    answer: [
      'Press and hold the message (on a computer, use the smiley beside it) and pick an emoji.',
      'You have one reaction per message. Pick another to change it, or the same one to take it off.',
      'Tap the small emoji on a message to see who reacted.',
    ],
    related: ['chat', 'chat-seen'],
  },
  {
    id: 'chat-seen', title: 'How do I know if someone has seen my message?',
    keys: ['seen', 'seen by', 'has seen', 'did they see', 'read my message', 'read receipt', 'seen my message', 'who has seen', 'who read', 'nabasa', 'nakita na ba', 'na seen', 'seenzone', 'small picture under'],
    answer: [
      'A small picture of each person sits under the **last message they have seen**.',
      'Tap a message to see the time and **Seen by** with the names.',
      '**Sent** under your message means nobody has opened the chat yet.',
    ],
    related: ['online', 'chat'],
  },
  {
    id: 'chat-archive', title: 'How do I archive or delete a chat?',
    keys: ['archive chat', 'delete chat', 'remove chat', 'clear chat', 'chat history', 'unarchive', 'three dot', 'three dots', 'burahin ang chat', 'clear my chat', 'hide a chat', 'hide chat', 'how to unarchive', 'archived chats', 'delete conversation', 'delete messages', 'remove conversation', 'old conversation', 'remove an old conversation', 'remove a conversation', 'clean up my chats', 'too many chats', 'delete my messages', 'my messages with'],
    answer: [
      'In the chat list press the **three-dot button** at the end of the chat.',
      '**Archive chat** moves it under **Archived chats**. It comes back when a new message arrives, or use **Unarchive chat**.',
      '**Delete chat** removes the whole history on **your side only**, for good. The other person keeps theirs.',
      'Delete cannot be undone. To just tidy up, use Archive.',
    ],
    related: ['chat'],
  },
  {
    id: 'notifications', title: 'I am not getting notifications.',
    keys: ['notification', 'notifications', 'bell', 'alert', 'alerts', 'push', 'no sound', 'sound', 'mute', 'unmute', 'not notified', 'walang notification', 'di tumutunog', 'chime', 'bell is not', 'mute the sound', 'phone alerts', 'alerts not working', 'no alert', 'did not get notified', 'ringtone', 'notify me', 'does not ring', 'phone does not ring', 'bell has a number', 'ring', 'vibrate', 'no notification', 'walang tunog', 'tunog', 'ang notification'],
    answer: [
      'The **bell** shows: a task or print job assigned to you, chat messages, and mentions.',
      'For alerts when the app is closed: profile button → **Settings** → turn on **Push notifications** on this phone or computer, and allow it when the browser asks.',
      'No sound? In Settings, check that notification sounds are not muted, and your device volume is up.',
      'A notification clears itself once you open the chat or task it is about.',
    ],
    related: ['comments'],
  },
  {
    id: 'my-status', title: 'How do I set Out of office or Sick?',
    keys: ['set status', 'my status', 'out of office', 'sick', 'leave', 'absent', 'working status', 'on leave', 'may sakit', 'wala sa office', 'be on leave', 'change my status', 'day off', 'absent tomorrow', 'not coming in', 'back to working', 'vacation', 'going on vacation', 'holiday', 'half day', 'out today', 'emergency leave', 'absent ako', 'bukas'],
    answer: [
      'Press your name (profile button), then **Set status**.',
      'Choose **Working**, **Out of office** or **Sick**. You can add a note and when you will be back.',
      'It returns to Working by itself at that time. Everyone sees it in chat and where tasks are assigned.',
    ],
    related: ['online'],
  },
  {
    id: 'password', title: 'I forgot my password, or want to change it.',
    keys: ['password', 'forgot', 'forgot password', 'reset password', 'change password', 'cannot sign in', 'cant sign in', 'cant log in', 'login', 'log in', 'locked out', 'nakalimutan', 'temporary password', 'username', 'reset my password', 'can not sign in', 'what is my username', 'my username', 'wrong password', 'sign in problem', 'new password', 'login does not work', 'my login', 'need a new password', 'cannot log in', 'forgot my login', 'maka log in', 'di ako maka', 'hindi ako maka log'],
    answer: [
      'Forgot it: ask an admin. They give you a new temporary password, and the app asks you to choose your own at sign-in.',
      'So you can reset it yourself next time: profile button → **Settings** → **Password recovery email** → **Add recovery email**, with your current password.',
      'Sign in with your **username**, not an email, unless the admin gave you an email login.',
    ],
    related: ['recovery-email', 'two-factor'],
  },
  {
    id: 'recovery-email', title: 'How do I add or change my recovery email?',
    keys: ['recovery email', 'recovery', 'add email', 'change email', 'my email', 'email for password', 'gmail', 'gmail for recovery', 'put my gmail', 'change recovery email', 'email on my account', 'set my email', 'register my email', 'where do i register', 'email for reset', 'reset email', 'set an email', 'email so i can reset', 'email to reset'],
    answer: [
      'Profile button → **Settings** → **Password recovery email**.',
      'Press **Add recovery email** (or **Change**), type the email and your **current password**, then save.',
      'Five wrong passwords lock it for 15 minutes. To remove it, ask Support.',
      'The app checks the spelling after the @ (gmial.com asks "did you mean gmail.com?") and refuses a domain that cannot receive email.',
    ],
    related: ['password'],
  },
  {
    id: 'two-factor', title: 'How do I turn on two-step sign-in?',
    keys: ['two factor', 'two-factor', '2fa', 'authenticator', 'code', 'security code', 'two step', 'otp', 'trusted device', 'set up 2fa', 'asking for a code', 'verification code', '6 digit', 'google authenticator', 'two step verification', 'extra security', 'more secure', 'secure my account', 'protect my account', 'security for my account', 'what is two factor'],
    answer: [
      'Profile button → **Settings** → **Two-factor authentication**.',
      'Scan the QR code with an authenticator app and type the code it shows.',
      'After that, sign-in asks for a code. A device you trust is not asked again for 30 days.',
    ],
    related: ['password'],
  },
  {
    id: 'dark-mode', title: 'How do I switch to dark mode?',
    keys: ['dark', 'dark mode', 'light mode', 'theme', 'appearance', 'too bright', 'madilim', 'screen too bright', 'change theme', 'night mode', 'bright', 'light theme', 'dark theme', 'black', 'app be black', 'dark background', 'hurts my eyes', 'color of the app', 'too white', 'at night', 'white screen at night'],
    answer: ['Profile button → **Settings** → **Appearance**. Choose light or dark. It is remembered on this device.'],
  },
  {
    id: 'slow', title: 'The app is slow, stuck, or shows old information.',
    keys: ['slow', 'stuck', 'frozen', 'loading', 'not loading', 'blank', 'white screen', 'old information', 'old data', 'not updating', 'refresh', 'update', 'bug', 'error', 'hang', 'mabagal', 'ayaw gumana', 'not working', 'offline', 'no internet', 'walang internet', 'page is not loading', 'is not updating', 'app hangs', 'hangs', 'hanging', 'see an error', 'crash', 'crashed', 'lag', 'laggy', 'froze', 'keeps loading', 'something went wrong', 'everything is frozen', 'is frozen', 'not refreshing', 'list is not refreshing', 'not responding', 'unresponsive', 'glitch', 'nag hang', 'page is blank', 'blank page', 'nag loading'],
    answer: [
      'First check your internet. The board and chats need it to load new things.',
      '**Refresh the page once** (or close the app and open it again). That also loads the newest version.',
      'What you typed on a task is saved by itself; a new work order you did not finish is kept as a draft.',
      'Still wrong after a refresh? Ask for a person below and say what you pressed and what you saw.',
    ],
    related: ['save', 'draft'],
  },
  {
    id: 'new-version', title: 'It says a new version is ready. What do I do?',
    keys: ['new version', 'version is ready', 'new version is ready', 'refresh button', 'press refresh', 'update the app', 'app update', 'latest version', 'newest version', 'update notice', 'version notice', 'will i lose my work if i refresh', 'bagong version', 'may update'],
    answer: [
      'A new release is out. Press **Refresh** on the notice to get it.',
      'What you saved is kept. A new work order you did not finish stays as a draft.',
      'Busy? Tap the notice to put it away. It asks again in about an hour.',
    ],
    related: ['slow', 'save'],
  },
  {
    id: 'client-wait', title: 'The client has not approved the layout yet. What do I do?',
    keys: ['client approval', 'waiting for client', 'waiting for the client', 'client has not approved', 'client not answering', 'client not replying', 'pending client', 'pending approval', 'client approved', 'customer approval', 'waiting for customer', 'overdue because of client', 'late because of client', 'not my fault late', 'overdue', 'past due', 'counted as late', 'monthly report', 'accomplishment', 'monthly accomplishment', 'credit', 'not in my report', 'missing in my report', 'client tag', 'hinihintay ang client', 'wala pang approval', 'hindi pa approve'],
    answer: [
      'Open the task and press **Mark as waiting for client approval** (the artist, reception or an admin can).',
      'While it is marked, the task is **not counted as late** and shows a **Client** tag on the board.',
      'The artist is credited in the **Monthly Report** from that day. A job sent back for changes keeps its credit.',
      'When the client says yes, press **Client approved**. Sending it to print also clears the mark.',
    ],
    related: ['status-meaning', 'send-to-print', 'workload'],
  },
  {
    id: 'credit', title: 'Who gets the credit for a job?',
    keys: ['credit', 'credited', 'my credit', 'who gets credit', 'not credited', 'no credit', 'my prints', 'my printed jobs', 'printed count', 'jobs printed', 'my count is wrong', 'count is wrong', 'wrong count', 'done printing count', 'art done', 'my accomplishment', 'accomplishment report', 'who printed', 'who made the task', 'made the task', 'who did the art', 'admin got my print', 'marked done by admin', 'operator credit', 'artist credit', 'kulang ang bilang', 'hindi nabilang', 'bilang ko'],
    answer: [
      'Three people are counted on every job: who **made the task**, the **artist** who did the art, and the **operator** who printed it.',
      'The artist is counted from the first time the file was attached (or the task was marked waiting for the client). A send back does not take it away.',
      'The print goes to the **operator who took the job** in the Print Queue, even when reception or an admin marks it done. Take the job with **Assign to me** before printing.',
      '**Workload** and the **Monthly Report** count the same way. Open the task\'s **History** to see who is credited.',
    ],
    related: ['history', 'workload', 'queue'],
  },
  {
    id: 'history', title: 'Where can I see the history of a task?',
    keys: ['history', 'task history', 'history of the task', 'who did what', 'what happened to this task', 'who changed', 'who sent back', 'who released', 'who printed this', 'who made this', 'log', 'activity', 'timeline', 'record of the task', 'kasaysayan', 'sino ang gumawa', 'sino nag print'],
    answer: [
      'Open the task. Under the comments, press **History**.',
      'It lists every step with the date and the person: made, given to an artist, file attached, sent back, sent to print, printed, reprint, released.',
      'The system writes it by itself. Nobody can change it.',
    ],
    related: ['credit', 'comments'],
  },
  {
    id: 'workload', title: 'What is the Workload screen?',
    keys: ['workload', 'dashboard', 'report', 'how many tasks', 'monthly report', 'stats', 'chart', 'totals', 'how many tasks does each', 'each artist have', 'who is free', 'who is busy', 'printing totals', 'most tasks', 'who has the most', 'least tasks', 'how busy', 'task count', 'overloaded', 'who is overloaded', 'too many tasks'],
    answer: [
      '**Workload** shows how many tasks each person has, the art each artist finished and the jobs each person printed.',
      'Admins also get the **Monthly Report** there: **Download PDF**, **Download CSV** (a spreadsheet for Excel) or **Print**.',
      'Use it to see who is free before assigning a job.',
    ],
    related: ['assign'],
  },
  {
    id: 'accounts', title: 'How do I add a staff account or change a role?', roles: ['admin', 'developer', 'support'],
    keys: ['account', 'accounts', 'add staff', 'new staff', 'new user', 'add user', 'role', 'change role', 'deactivate', 'switch off', 'remove staff', 'printing area of operator', 'site', 'create account', 'account for new employee', 'new employee', 'turn off an account', 'disable account', 'set printing area of operator', 'make someone admin', 'employee', 'register a new staff', 'new staff member', 'resigned', 'remove their access', 'remove access', 'left the company', 'new hire', 'bagong user', 'add ng bagong user', 'new user account'],
    answer: [
      'Admins only: open **Admin Tools** in the menu.',
      'Add the person with a **username** and a **temporary password**. They choose their own password at first sign-in.',
      'From the same screen change a role, set an operator\'s printing area, or switch an account off.',
    ],
    related: ['password'],
  },
  {
    id: 'manual', title: 'Where is the user manual?',
    keys: ['manual', 'guide', 'instructions', 'how to use', 'tutorial', 'user manual', 'whats new', "what's new", 'is there a guide', 'what changed', 'changed in the update', 'whats in the update', 'new features', 'latest changes', 'release notes', 'documentation', 'is there documentation', 'handbook', 'where can i read', 'learn the app', 'read how to use', 'how to use this'],
    answer: [
      'Profile button → **Help** → **User Manual**. You can search it.',
      '**What\'s new** in the profile menu lists the latest changes, by date.',
    ],
  },
];

// ---- understanding what was typed -------------------------------------------
const norm = (s: string) => ` ${s.toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9@]+/g, ' ').trim()} `;
const has = (text: string, phrases: string[]) => phrases.some((p) => text.includes(` ${p} `) || text.includes(norm(p)));

const HUMAN = ['human', 'a person', 'real person', 'agent', 'support staff', 'talk to support', 'talk to a', 'talk to someone', 'speak to', 'tao', 'kausap', 'kausapin', 'live chat', 'representative', 'live support'];
const DONE = ['all good', 'all goods', 'its good', 'good now', 'ok na', 'okay na', 'oks na', 'ayos na', 'okay', 'ok', 'k', 'goods', 'solved', 'fixed', 'it works', 'works now', 'working now', 'got it', 'gets ko na', 'gets', 'thanks', 'thank you', 'thank u', 'ty', 'salamat', 'maraming salamat', 'yes', 'yep', 'yeah', 'oo', 'opo', 'done', 'nothing else', 'thats all', 'wala na', 'no more', 'resolved', 'perfect', 'nice', 'great'];
const NOT_DONE = ['no', 'nope', 'not yet', 'hindi', 'hindi pa', 'di pa', 'dili', 'still', 'not working', 'didnt work', 'did not work', 'doesnt work', 'does not work', 'not solved', 'wrong', 'mali'];
const HELLO = ['hi', 'hello', 'hey', 'good morning', 'good afternoon', 'good evening', 'kumusta', 'kamusta', 'musta', 'maayong', 'yo', 'help', 'help me', 'tulong', 'patulong', 'question', 'may tanong', 'tanong'];

export type SupportIntent =
  | { kind: 'answer'; topic: SupportTopic }
  | { kind: 'human' }
  | { kind: 'done' }
  | { kind: 'not_done' }
  | { kind: 'hello' }
  | { kind: 'unknown' };

// Small words that say nothing about the topic (English and Filipino).
const STOP = new Set(('a an the to of in on at for and or is are was be it this that these those my me i you we us our your do does did done how what where when why who which can could should would will '
  + 'with from by as have has had not no yes please there here its im about into out up then than so if but just get got need want like make made use using one some any all also very too still am getting going go see know way thing something anything already lot put let tell say says said really now today again time thing same last first right long day much many more other new good bad big small '
  + 'po ba ang ng sa na ko mo si ni ay mga yung para kung pag paano saan ano bakit lang din rin naman pa nga kasi ako ikaw siya namin natin').split(' '));
const stem = (w: string) => (w.length > 5 ? w.replace(/(ing|ed|es|s)$/, '') : w.length > 3 ? w.replace(/s$/, '') : w);
const wordsOf = (text: string) => norm(text).trim().split(' ').filter((w) => w && !STOP.has(w)).map(stem);

interface TopicIndex { topic: SupportTopic; phrases: string[]; keyWords: Set<string>; strongWords: Set<string>; titleWords: Set<string>; answerWords: Set<string>; }
let INDEX: TopicIndex[] | null = null;
let IDF: Map<string, number> | null = null;
function index(): TopicIndex[] {
  if (INDEX) return INDEX;
  INDEX = SUPPORT_TOPICS.map((topic) => ({
    topic,
    phrases: topic.keys.map(norm),
    keyWords: new Set(topic.keys.flatMap(wordsOf)),
    // Words that name the topic by themselves: its one-word keys.
    strongWords: new Set(topic.keys.filter((k) => !k.trim().includes(' ')).flatMap(wordsOf)),
    titleWords: new Set(wordsOf(topic.title)),
    answerWords: new Set(topic.answer.flatMap(wordsOf)),
  }));
  // A word that only one or two topics use says more than one they all use.
  const df = new Map<string, number>();
  for (const t of INDEX) for (const w of new Set([...t.keyWords, ...t.titleWords, ...t.answerWords])) df.set(w, (df.get(w) ?? 0) + 1);
  IDF = new Map([...df].map(([w, n]) => [w, Math.log(1 + INDEX!.length / n)]));
  return INDEX;
}

/**
 * The topic that best fits what was typed (null when nothing fits well
 * enough). A whole phrase from a topic's key list counts most; after that
 * each word of the question counts by how much it says: a word from the key
 * list or the question's title a lot, a word that only appears in the answer
 * a little.
 */
export function matchTopic(text: string): SupportTopic | null {
  const t = norm(text);
  // A suggested question tapped (or typed) as it is written.
  const exact = SUPPORT_TOPICS.find((topic) => norm(topic.title) === t);
  if (exact) return exact;
  const first = rank(text)[0];
  return first?.sure ? first.topic : null;
}

/** Every topic that fits at all, best first. `sure` = good enough to answer with; the rest are "did you mean". */
export function rank(text: string): { topic: SupportTopic; score: number; sure: boolean }[] {
  const t = norm(text);
  const asked = [...new Set(wordsOf(text))];
  const ixs = index();
  const top = Math.log(1 + ixs.length);
  // How much the question says in all: a word the helper has never seen counts in full.
  const said = asked.reduce((n, w) => n + (IDF!.get(w) ?? top), 0);
  const out: { topic: SupportTopic; score: number; sure: boolean }[] = [];
  for (const ix of ixs) {
    let score = 0, phrase = false, understood = 0, words = 0, strong = 0;
    for (const key of ix.phrases) {
      if (!t.includes(key)) continue;
      const n = key.trim().split(' ').length;
      score += n > 1 ? 3 + n : 2;
      if (n > 1) phrase = true;
    }
    for (const w of asked) {
      const idf = IDF!.get(w) ?? 0;
      if (ix.keyWords.has(w)) { score += 1.2 * idf; understood += idf; words += 1; }
      else if (ix.titleWords.has(w)) { score += 0.9 * idf; understood += idf; words += 1; }
      else if (ix.answerWords.has(w)) score += 0.3 * idf;
      if (ix.strongWords.has(w)) strong += 1;
    }
    if (score <= 0.6) continue;
    // Sure: a whole key phrase was typed. Or its words carry a good part of what was said:
    // two of them and a third of it, or one word that names the topic and most of it.
    const part = said > 0 ? understood / said : 0;
    const sure = score >= 2.4 && (phrase || (words >= 2 && part >= 0.34) || (strong >= 1 && part >= 0.6));
    out.push({ topic: ix.topic, score, sure });
  }
  return out.sort((a, b) => Number(b.sure) - Number(a.sure) || b.score - a.score);
}
/** "Did you mean…": the closest questions when the helper is not sure. */
export const closestTopics = (text: string, count = 3) => rank(text).slice(0, count).map((r) => r.topic);

/**
 * What the person means. `awaitingDone` = the helper has just asked "did that
 * solve it?", so a bare "yes" / "no" is an answer to that, not a new question.
 */
export function readMessage(text: string, awaitingDone: boolean): SupportIntent {
  const t = norm(text);
  if (!t.trim()) return { kind: 'unknown' };
  const words = t.trim().split(' ').length;
  if (has(t, HUMAN) && !/ (assign|artist|operator|add staff|account) /.test(t)) return { kind: 'human' };
  const topic = matchTopic(text);
  // A short reply right after "did that solve it?" is about that question.
  if (awaitingDone && words <= 6 && (!topic || words <= 3)) {
    if (has(t, NOT_DONE)) return { kind: 'not_done' };
    if (has(t, DONE)) return { kind: 'done' };
  }
  if (topic) return { kind: 'answer', topic };
  if (has(t, NOT_DONE) && words <= 6) return { kind: 'not_done' };
  if (has(t, DONE) && words <= 6) return { kind: 'done' };
  if (has(t, HELLO) && words <= 5) return { kind: 'hello' };
  return { kind: 'unknown' };
}

/** Questions to offer first: the ones for this role, then the common ones. */
export function suggestionsFor(role: Role | undefined, count = 5): SupportTopic[] {
  const mine = SUPPORT_TOPICS.filter((t) => role && t.roles?.includes(role));
  const common = ['files', 'find', 'save', 'notifications', 'password', 'chat', 'status-meaning']
    .map((id) => SUPPORT_TOPICS.find((t) => t.id === id)!).filter((t) => !mine.includes(t));
  return [...mine, ...common].slice(0, count);
}
export const topicById = (id: string) => SUPPORT_TOPICS.find((t) => t.id === id) ?? null;

// ---- the conversation, kept in memory for this session only ------------------
export interface SupportMsg {
  from: 'bot' | 'me';
  text: string;
  at: string;
  /** Lines of an answer (steps), shown as a list. */
  steps?: string[];
  /** The topic an answer came from. */
  topic?: string;
}
/** The conversation as plain text, for the person who takes over and for the saved report. */
export function transcriptText(msgs: SupportMsg[], name: string): string {
  return msgs.map((m) => {
    const who = m.from === 'me' ? name : 'Helper';
    const body = [m.text, ...(m.steps ?? []).map((s, i) => `${i + 1}. ${s}`)].filter(Boolean).join('\n');
    return `${who}: ${body.replace(/\*\*/g, '')}`;
  }).join('\n');
}
