// coded with <3 by rayhan
// contact: officialrayhan@notesbubble.com

// Configuration: Map keywords to education levels and subjects
const EDUCATION_LEVELS = {
  // Primary Levels
  'p1': 'Primary 1',
  'p2': 'Primary 2',
  'p3': 'Primary 3',
  'p4': 'Primary 4',
  'p5': 'Primary 5',
  'p6': 'Primary 6',
  
  // Lower Secondary
  'sec 1': 'Lower Secondary (Sec 1 2)',
  'sec 2': 'Lower Secondary (Sec 1 2)',
  'secondary 1': 'Lower Secondary (Sec 1 2)',
  'secondary 2': 'Lower Secondary (Sec 1 2)',
  
  // Upper Secondary
  'sec 3': 'Upper Secondary (Sec 3 4 5)',
  'sec 4': 'Upper Secondary (Sec 3 4 5)',
  'sec 5': 'Upper Secondary (Sec 3 4 5)',
  'secondary 3': 'Upper Secondary (Sec 3 4 5)',
  'secondary 4': 'Upper Secondary (Sec 3 4 5)',
  'secondary 5': 'Upper Secondary (Sec 3 4 5)',
  
  // O Levels
  'o level': 'O levels',
  'olevel': 'O levels',
  'o-level': 'O levels',
  
  // A Levels
  'a level': 'A levels',
  'alevel': 'A levels',
  'a-level': 'A levels',
  'h1': 'A levels/H1',
  'h2': 'A levels/H2',
  'h3': 'A levels/H3',
  
  // International Baccalaureate
  'ib': 'International Baccalaureate',
  'ibdp': 'International Baccalaureate',
  'international baccalaureate': 'International Baccalaureate',
  
  // Integrated Programme
  'ip': 'Integrated Programme',
  'integrated programme': 'Integrated Programme',
  
  // University
  'university': 'University',
  'ntu': 'University/(NTU) National Technological University',
  'nus': 'University/(NUS) National University of Singapore'
};

const SUBJECTS = {
  // Languages
  'english': 'English',
  'el': 'English',
  'chinese': 'Chinese',
  'malay': 'Malay',
  'tamil': 'Tamil',
  'mtl': 'MTL (incl. Higher MTL and NTIL)',
  'higher chinese': 'MTL (incl. Higher MTL and NTIL)/Higher Chinese',
  'higher malay': 'MTL (incl. Higher MTL and NTIL)/Higher Malay',
  'higher tamil': 'MTL (incl. Higher MTL and NTIL)/Higher Tamil',
  
  // Mathematics
  'math': 'Mathematics',
  'mathematics': 'Mathematics',
  'amath': 'Mathematics (AM EM POA)/Additional Math',
  'emath': 'Mathematics (AM EM POA)/Elementary Math',
  'additional math': 'Mathematics (AM EM POA)/Additional Math',
  'elementary math': 'Mathematics (AM EM POA)/Elementary Math',
  'poa': 'Mathematics (AM EM POA)/Principles of Accounts',
  'principles of accounts': 'Mathematics (AM EM POA)/Principles of Accounts',
  
  // Sciences
  'science': 'Science',
  'physics': 'Pure Science (PP PB PC)/Pure Physics',
  'chemistry': 'Pure Science (PP PB PC)/Pure Chemistry',
  'biology': 'Pure Science (PP PB PC)/Pure Biology',
  'combined physics': 'Combined Science (CP CB CC)/Combined Physics',
  'combined chemistry': 'Combined Science (CP CB CC)/Combined Chemistry',
  'combined biology': 'Combined Science (CP CB CC)/Combined Biology',
  
  // Humanities
  'history': 'History',
  'geography': 'Geography',
  'social studies': 'Elective Humanities (EH EG SS)/Social Studies',
  'elective history': 'Elective Humanities (EH EG SS)/Elective History',
  'elective geography': 'Elective Humanities (EH EG SS)/Elective Geography',
  'pure history': 'Pure Humanities (PH PG PL)/Pure History',
  'pure geography': 'Pure Humanities (PH PG PL)/Pure Geography',
  'pure literature': 'Pure Humanities (PH PG PL)/Pure Literature',
  
  // Creative Arts
  'art': 'Creative Arts (DNT ART MUS NFS)/Art',
  'music': 'Creative Arts (DNT ART MUS NFS)/Music',
  'dnt': 'Creative Arts (DNT ART MUS NFS)/Design and Technology',
  'design and technology': 'Creative Arts (DNT ART MUS NFS)/Design and Technology',
  'nutrition': 'Creative Arts (DNT ART MUS NFS)/Nutrition and Food Science',
  'food science': 'Creative Arts (DNT ART MUS NFS)/Nutrition and Food Science',
  
  // Special Subjects
  'computing': 'Special Subjects (COM ELC ECN)/Computing',
  'economics': 'Special Subjects (COM ELC ECN)/Economics',
  'electronics': 'Special Subjects (COM ELC ECN)/Electronics'
};

// Default folder for unmatched files
const DEFAULT_FOLDER = 'admin_review';

export default {
  async fetch(request, env) {
    // This worker is designed to be triggered by R2 events, not direct HTTP requests
    return new Response('Study Organizer Worker is running. Configure R2 events to trigger file processing.');
  },

  async queue(batch, env) {
    // Process each message in the queue
    for (const message of batch.messages) {
      try {
        const event = JSON.parse(message.body);
        await processR2Event(event, env);
      } catch (err) {
        console.error(`Error processing message ${message.id}:`, err);
      }
    }
  }
};

/**
 * Process an R2 event to organize uploaded files
 */
async function processR2Event(event, env) {
  // Validate event structure
  if (!event?.Records?.[0]?.s3?.object?.key) {
    console.error('Invalid event structure:', JSON.stringify(event));
    return;
  }

  const key = event.Records[0].s3.object.key;
  const bucket = env.STUDY_BUCKET;

  // Skip already processed files or files in admin_review
  if (key.startsWith('processed/') || key.startsWith(`${DEFAULT_FOLDER}/`)) {
    console.log(`Skipping already processed file: ${key}`);
    return;
  }

  try {
    // Determine target folder based on filename
    const targetPath = determineTargetPath(key);
    
    // Skip if already in correct folder
    if (key.startsWith(targetPath)) {
      console.log(`File ${key} is already in correct folder`);
      return;
    }

    // Move file to target folder
    await moveFile(bucket, key, targetPath);
    console.log(`Moved ${key} to ${targetPath}`);
    
  } catch (err) {
    console.error(`Error processing file ${key}:`, err);
    
    // Move to admin_review on error
    try {
      await moveFile(bucket, key, DEFAULT_FOLDER);
      console.log(`Moved ${key} to ${DEFAULT_FOLDER} due to error`);
    } catch (moveErr) {
      console.error(`Failed to move ${key} to ${DEFAULT_FOLDER}:`, moveErr);
    }
  }
}

/**
 * Determine the target path based on filename keywords
 */
function determineTargetPath(filename) {
  const name = filename.toLowerCase();
  
  // First, determine education level
  let educationLevel = '';
  for (const [keyword, level] of Object.entries(EDUCATION_LEVELS)) {
    if (name.includes(keyword)) {
      educationLevel = level;
      break;
    }
  }
  
  // If no education level found, default to admin_review
  if (!educationLevel) {
    return DEFAULT_FOLDER;
  }
  
  // Then, determine subject within the education level
  let subjectPath = '';
  for (const [keyword, subject] of Object.entries(SUBJECTS)) {
    if (name.includes(keyword)) {
      subjectPath = subject;
      break;
    }
  }
  
  // If no subject found, place in education level with "Other" subfolder
  if (!subjectPath) {
    return `${educationLevel}/Other/${filename}`;
  }
  
  return `${educationLevel}/${subjectPath}/${filename}`;
}

/**
 * Move a file from one location to another in R2
 */
async function moveFile(bucket, sourceKey, targetPath) {
  // Copy to new location
  await bucket.copy(targetPath, sourceKey);
  
  // Delete original
  await bucket.delete(sourceKey);
}
