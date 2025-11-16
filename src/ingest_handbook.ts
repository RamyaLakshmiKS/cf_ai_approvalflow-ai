// Note: We intentionally _do not_ use NodeFS APIs (Workers do not support 'fs')

interface Env {
  VECTORIZE: VectorizeIndex;
  AI: Ai;
  // Other optional env variables
}

interface HandbookChunk {
  id: string;
  content: string;
  metadata: {
    section: string;
    category: string;
    last_updated: string;
  };
}

// A small example Worker handler that ingests a sample Handbook into the
// configured Vectorize index. This performs the following steps:
// 1. Chunk the handbook into content segments
// 2. Generate embeddings using the Workers AI provider
// 3. Upsert the vectors into the Vectorize index
//
// To run this locally, make sure your `wrangler.jsonc` includes:
//  - an `ai` binding (e.g. the Workers AI Gateway)
//  - a `vectorize` binding for the index (e.g. `handbook_vectors`)

const HANDBOOK_CONTENT = `# Cloudflare Employee Handbook [ Internal Use Only - Sample for demo]

## Section 1: Welcome to Cloudflare

### A Message from our CEO

Welcome to the Cloudflare team! We are so excited to have you join us on our mission. We started this company in 2009 with the goal of solving a simple problem: making the Internet faster and safer. From those humble beginnings, we've grown into a global team that is fundamental to how the Internet works. But our core idea remains the same: helping to build a better Internet.

Every person here plays a crucial role in that mission. This handbook is your guide to help you get started, understand how we work, and know what you can expect from us (and what we expect from you). We trust you to do great work, and we are here to support you. We're glad you're here.

## Section 2: Our Company & Culture

*   **Our Mission:** To help build a better Internet.
*   **Our Vision:** A world where the Internet is fast, secure, and reliable for everyone, everywhere.
*   **Our Values:**
    *   **Trust:** We earn trust by being credible, reliable, and transparent. We assume good intent and empower our teams to make decisions.
    *   **Curiosity:** We are intellectually curious and love to solve problems. We ask "why?" and are not afraid to challenge assumptions. We learn from our successes and our failures.
    *   **Impact:** We are focused on making a meaningful impact. We are disciplined, action-oriented, and accountable for our results. We prioritize work that matters for our users and our business.
    *   **Kindness:** We treat each other with respect and empathy. We believe that diverse teams with different perspectives are stronger. We collaborate and communicate with kindness.

### 2.1 Code of Conduct & Ethics

We are committed to providing a workplace that is free of discrimination and harassment. We treat each other with respect, regardless of background, identity, or belief. This commitment applies to all interactions, whether in the office, in a virtual meeting, or at a company event. We expect all employees to adhere to the highest standards of ethical conduct, including avoiding conflicts of interest and protecting confidential company and customer data. Any violation of this code will result in disciplinary action, up to and including termination.

### 2.2 Equal Employment Opportunity

Cloudflare shall follow the spirit and intent of all federal, state and local employment law and is committed to equal employment opportunity. To that end, we will not discriminate against any employee or applicant in a manner that violates the law. We are committed to providing equal opportunity for all employees and applicants without regard to race, color, religion, national origin, sex, age, marital status, sexual orientation, disability, or any other characteristic protected under federal, state or local law. Each person is evaluated on the basis of personal skill and merit.

### 2.3 Policy Against Workplace Harassment

Our commitment begins with the recognition that harassment is unlawful. This policy applies to all work-related settings and activities, whether inside or outside the workplace, and includes business trips and business-related social events. Harassment may include: (1) epithets, slurs, negative stereotyping, jokes, or threatening, intimidating, or hostile acts that relate to a protected category; and (2) written or graphic material that denigrates or shows hostility toward an individual or group that is circulated in the workplace.

### 2.4 Reporting of Harassment

If you believe that you have experienced or witnessed harassment, you should report the incident immediately to your supervisor or to Human Resources. We will promptly and thoroughly investigate all reports of harassment as discreetly and confidentially as practicable. The investigation would generally include a private interview with the person making a report. If it is determined that improper behavior occurred, we will take appropriate disciplinary action. No employee will be subject to retaliation for reporting violations of this policy in good faith.

### 2.5 Communication Standards

Clear communication is key to our success. We default to open and asynchronous communication. Use public channels in our chat system for work-related discussions unless the topic is sensitive. Document decisions and processes in our shared knowledge base.

## Section 3: Your Employment

### 3.1 Voluntary At-Will Employment
Unless an employee has a written employment agreement with Cloudflare which provides differently, all employment is "at-will." That means that employees may be terminated from employment with or without cause, and employees are free to leave employment with or without cause.

### 3.2 Employment Status
Your role is classified as either Full-time or Part-time, and either Exempt or Non-Exempt, which determines overtime eligibility. Please refer to your offer letter for your specific classification.
*   **Full-Time Employee**: Regularly works at least 35 hours per week.
*   **Part-Time Employee**: Regularly works less than 35 hours per week.

### 3.3 Attendance and Punctuality
Punctuality and regular attendance are expected of all employees. Excessive absences (whether excused or unexcused), tardiness or leaving early is unacceptable. If you are absent for any reason, you must notify your supervisor as far in advance as possible and no later than one hour before the start of your scheduled work day. An employee who is absent from work for three consecutive days without notification will be considered to have voluntarily terminated his or her employment.

### 3.4 Work Hours & Remote Work
Our core hours are 10:00 AM to 4:00 PM in your local time. We are a hybrid company, and your designated work arrangement is specified in your team charter. We trust you to work with your manager to ensure your work location supports your productivity and team collaboration.

### 3.5 Performance Reviews
We conduct performance reviews twice a year, in June and December. This is a two-way conversation between you and your manager to discuss your impact, career growth, and feedback.

### 3.6 Outside Employment
Individuals may hold outside jobs as long as they meet the performance standards of their job with Cloudflare. Outside employment that constitutes a conflict of interest is prohibited. Employees may not receive any income or material gain from individuals or organizations for materials produced or services rendered while performing their jobs with Cloudflare.

---

## Section 4: Paid Time Off (PTO) & Leave

At Cloudflare, we believe that rest is essential for high-quality work and personal well-being. We want you to take time off to recharge.

### 4.1 Paid Time Off (PTO) Policy

*   **How It Works:** We use an accrual-based PTO system. Your available PTO balance is tracked and can be used for vacation, personal time, or sick leave. PTO is accrued on a monthly basis.
*   **PTO Accrual Rates:**
    *   **Junior Employees**: Accrue 1.5 days of PTO for each full month of service (18 days per year).
    *   **Senior Employees**: Accrue 2 days of PTO for each full month of service (24 days per year).
*   **PTO Rollover:** You may roll over up to 5 unused PTO days into the next calendar year. Any balance above 5 days will be forfeited on December 31st.
*   **Requesting Time Off:**
    1.  Discuss your planned time off with your manager as early as possible, ideally at least two weeks in advance for vacations.
    2.  Submit all requests through our **ApprovalFlow AI** system. The AI assistant will validate your request against your balance and company policy.
    3.  For unplanned absences (like illness), please notify your manager and your immediate team (e.g., in your team's chat channel) as soon as possible on the first day of your absence.

*   **Auto-Approval Rules:** To streamline the process, many requests are approved automatically based on your role:
    *   **Junior Employees**: Requests for **3 consecutive days or less** are automatically approved.
    *   **Senior Employees**: Requests for **10 consecutive days or less** are automatically approved.
    *   Any request exceeding these limits, or if your balance is insufficient, will be escalated to your manager for manual review.

*   **Company Blackout Periods:** To ensure we are adequately staffed during critical times, PTO is generally not approved during the following "blackout" periods:
    *   The last week of each fiscal quarter (e.g., March 24-31, June 23-30, etc.).
    *   The first week of January.
    *   During major product launches (dates will be announced in advance).

### 4.2 Company Holidays

We observe 10 paid company holidays per year:
* New Year's Day
* Martin Luther King Jr. Day
* Presidents' Day
* Memorial Day
* Juneteenth
* Independence Day
* Labor Day
* Thanksgiving Day
* Day after Thanksgiving
* Christmas Day

### 4.3 Other Leave Policies

*   **Parental Leave:** We offer 16 weeks of fully paid leave for all new parents (birth, adoption, or foster placement).
*   **Bereavement Leave:** We offer up to 10 paid days for the loss of a close family member (spouse, child, parent, sibling) and up to 5 days for other relatives.
*   **Jury Duty:** We provide paid leave for the full duration of your jury duty service. Please provide a copy of your summons to HR.

---

## Section 5: Compensation & Benefits

*   **Payroll:** We run payroll semi-monthly, on the 15th and the last day of the month.
*   **Health Benefits:** We cover 90% of premiums for medical, dental, and vision for you and 70% for your dependents.
*   **Retirement:** We offer a 401(k) plan and match 100% of your contributions up to 4% of your salary.
*   **Equity:** Most employees are eligible for Restricted Stock Units (RSUs) as part of their compensation, which vest over a four-year period.
*   **Wellness Stipend:** We offer a $100 monthly stipend that can be used for gym memberships, fitness classes, or mental wellness apps.

---

## Section 6: Travel & Expense Reimbursement

Our philosophy on expenses is simple: **spend company money as you would spend your own.** We trust you to be responsible and sensible.

### 6.1 General Policy

*   **What We Cover:** We will reimburse you for all reasonable and necessary expenses you pay for while doing your job.
*   **How to Get Reimbursed:**
    1.  Submit all expenses through our **ApprovalFlow AI** system.
    2.  You must include a digital copy of the itemized receipt for any expense over **$75**. For expenses under $75, a receipt is not required but is encouraged.
    3.  Please submit your expenses within 30 days of incurring them.

*   **Auto-Approval Limits:** To accelerate reimbursement, expenses are automatically approved based on your role, provided they comply with policy:
    *   **Junior Employees**: Expense reports with a total of **$100 or less** are automatically approved.
    *   **Senior Employees**: Expense reports with a total of **$500 or less** are automatically approved.
    *   Reports exceeding these limits will be escalated to your manager for review.

### 6.2 Travel Expenses

*   **Air Travel:** Book economy class for all domestic flights. Book "premium economy" for any international flight over 6 hours long. Please book flights at least 14 days in advance. Last-minute bookings require manager approval.
*   **Hotels:** Please choose a safe, comfortable, and well-located standard business hotel (e.g., Hilton, Marriott, Hyatt). Avoid luxury or resort-style properties unless it is for a specific conference venue.
*   **Ground Transportation:** Use ride-sharing services or taxis. For rental cars, choose a mid-size or standard car class. Luxury or sports cars are not reimbursable.
*   **Meals (Per Diem):** When traveling for business, your meal expenses will be reimbursed based on a per diem rate. This covers all meals, snacks, and tips.
    *   **Domestic Travel**: $75 per day.
    *   **International Travel**: $125 per day.

### 6.3 Non-Reimbursable Expenses
The following are examples of expenses that will not be reimbursed:
*   Alcoholic beverages (unless dining with a client, limited to 1-2 drinks per person).
*   Parking tickets, speeding tickets, or other traffic violations.
*   In-room hotel movie rentals or mini-bar purchases (except for bottled water).
*   Airline upgrade fees for seat selection or extra legroom (except for pre-approved international flights).
*   Spouse or family travel costs.
*   Lost personal property.

### 6.4 Home Office & Training

*   **Home Office:** For fully remote employees, we offer a one-time $500 stipend to set up your home office and a $50 monthly stipend for internet.
*   **Training:** We have a $2,000 per year budget for your professional development (conferences, courses, books). Please discuss plans with your manager.

---

## Section 7: IT & Information Security

### 7.1 Acceptable Use of Systems
Company-provided equipment (laptops, phones, etc.) and systems (email, internet, voice mail) are for business use. Incidental personal use is permitted, but should not interfere with your work, consume significant resources, or violate any company policy. All data in the company's computer and communication systems are the property of Cloudflare. The company may inspect and monitor such data at any time. No individual should have any expectation of privacy for messages or other data recorded in our systems.

### 7.2 Internet Acceptable Use Policy
No use of the Internet should conflict with your primary job duties. The Internet must not be used to access, create, transmit, print or download material that is derogatory, defamatory, obscene, or offensive. Downloading or disseminating of copyrighted material without permission from the publisher is an infringement of copyright law. You should not download personal e-mail or Instant Messaging software to company computers. The Internet should not be used to send or participate in chain letters, pyramid schemes, or to endorse political candidates.

### 7.3 System Security
*   **Passwords:** Your work passwords must be unique, complex (at least 12 characters with a mix of letters, numbers, and symbols), and changed every 90 days. Do not share your password with anyone.
*   **Software:** Do not install unauthorized or unlicensed software on your devices. Individual users should never load personal software. This practice risks the introduction of computer viruses.
*   **Hardware:** Individual users should never make changes or modifications to the hardware configuration of computer equipment.
*   **Guest Policy:** If you are working from a Cloudflare office, all visitors must be registered in advance and wear a visitor badge at all times. You are responsible for your guests while they are on the premises.

---

## Section 8: Personnel Policies & Records

### 8.1 Personnel Records
A personnel file shall be kept for each employee. It is the responsibility of each employee to promptly notify Human Resources in writing of any changes in personnel data, including personal mailing addresses, telephone numbers, and individuals to be contacted in the event of an emergency.

### 8.2 Non-Disclosure of Confidential Information
The protection of privileged and confidential information is vital. Employees may not disclose confidential information to anyone who is not employed by Cloudflare. Such information includes, but is not limited to: compensation data, financial information, information related to donors, and pending projects.

### 8.3 Solicitation
Employees are prohibited from soliciting (personally or via electronic mail) for any unauthorized purpose anywhere on company property during work time. "Work time" does not include lunch periods or breaks.

### 8.4 Return of Property
Upon separation from employment, employees must return all company property, including but not limited to: laptops, phones, credit cards, identification badges, office keys, and all intellectual property (e.g., written materials, work products). The company may withhold from the employee's final paycheck the cost of any property which is not returned.

### 8.5 Separation of Employment
Reasons for discharge may include, but are not limited to:
*   Falsifying or withholding information on your employment application or other records.
*   Performance at work below an acceptable level.
*   Insubordination or refusing to work.
*   Negligence in the performance of duties.
*   Breach of confidentiality.
*   Excessive tardiness or absenteeism.
*   Engaging in discriminatory or abusive behavior.
`;

export async function ingestHandbook(env: Env, content?: string) {
  if (!env || !env.AI) {
    throw new Error(
      "AI binding is not configured. Please configure `ai` in wrangler.jsonc."
    );
  }
  if (!env || !env.VECTORIZE) {
    throw new Error(
      "VECTORIZE binding is not configured. Please add the `vectorize` binding in wrangler.jsonc."
    );
  }
  // Use the embedded handbook content
  const handbookContent = content || HANDBOOK_CONTENT;

  // Chunk the handbook
  const chunks = chunkHandbook(handbookContent);

  // Generate embeddings and upsert
  const vectors: { id: string; values: number[]; metadata: unknown }[] = [];
  for (const chunk of chunks) {
    const embedding = await env.AI.run("@cf/baai/bge-base-en-v1.5", {
      text: chunk.content
    });

    vectors.push({
      id: chunk.id,
      values: (embedding as { data: number[][] }).data[0],
      metadata: chunk.metadata
    });
  } // Upsert to Vectorize in batches
  const batchSize = 10;
  for (let i = 0; i < vectors.length; i += batchSize) {
    const batch = vectors.slice(i, i + batchSize);
    await env.VECTORIZE.upsert(batch as VectorizeVector[]);
  }

  return {
    message: `Successfully ingested ${chunks.length} chunks into Vectorize`,
    total_chunks: chunks.length
  };
}

// Note: There is no default fetch handler exported to avoid exposing
// an ingestion endpoint. Use `ingestHandbook(env, content?)` directly in
// server-side scripts or run the local ingestion script to generate
// `data/handbook_vectors.json` for upload to Vectorize via Wrangler CLI.

function chunkHandbook(content: string): HandbookChunk[] {
  const chunks: HandbookChunk[] = [];
  const lines = content.split("\n");
  let currentSection = "";
  let currentContent = "";
  let chunkId = 0;

  const isSectionHeader = (l: string) => {
    // Treat lines that start with '## Section' or '## ' as section headers
    return l.trim().startsWith("## ");
  };

  const extractSectionName = (headerLine: string) => {
    // headerLine will be something like '## Section 4: Paid Time Off (PTO) & Leave'
    const text = headerLine.replace(/^##\s+/, "").trim();
    // If it contains 'Section N: ', drop the leading "Section N: " part
    const sectionMatch = text.match(/Section\s+\d+:\s*(.*)/i);
    if (sectionMatch?.[1]) {
      return sectionMatch[1].trim();
    }
    return text;
  };

  for (const line of lines) {
    // If we encounter a doc-level title (starting with '# ') before the first
    // section, use it as the 'section' for any leading content.
    if (line.trim().startsWith("# ") && !currentSection) {
      currentSection = line.replace(/^#\s+/, "").trim();
      continue;
    }

    if (isSectionHeader(line)) {
      // If there's an existing section content, push it as a chunk
      if (currentContent.trim()) {
        chunks.push({
          id: `chunk-${chunkId++}`,
          content: currentContent.trim(),
          metadata: {
            section: currentSection,
            category: getCategory(currentSection),
            last_updated: "2025-01-01"
          }
        });
        currentContent = "";
      }

      // Set the current section to the parsed header name
      currentSection = extractSectionName(line);
      currentContent += `${line}\n`;
    } else {
      currentContent += `${line}\n`;
    }
  }

  // Add the last accumulated section as a chunk
  if (currentContent.trim()) {
    chunks.push({
      id: `chunk-${chunkId++}`,
      content: currentContent.trim(),
      metadata: {
        section: currentSection,
        category: getCategory(currentSection),
        last_updated: "2025-01-01"
      }
    });
  }

  return chunks;
}

function getCategory(section: string): string {
  const categoryMap: Record<string, string> = {
    "Welcome to Cloudflare": "general",
    "Our Company & Culture": "culture",
    "Your Employment": "employment",
    "Paid Time Off (PTO) & Leave": "pto",
    "Compensation & Benefits": "benefits",
    "Travel & Expense Reimbursement": "expenses",
    "IT & Information Security": "security",
    "Personnel Policies & Records": "policies"
  };

  return categoryMap[section] || "general";
}
