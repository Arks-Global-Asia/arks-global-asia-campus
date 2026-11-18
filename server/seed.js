export const syllabus = [
  {
    title: "DevOps foundations",
    detail: "Culture, SDLC, Agile and delivery lifecycle",
  },
  {
    title: "Linux & Git",
    detail: "Linux essentials, Git branches, merging and collaboration",
  },
  {
    title: "Containers with Docker",
    detail: "Images, Dockerfiles, registries and Compose",
  },
  {
    title: "Kubernetes essentials",
    detail: "Pods, deployments, services and configuration",
  },
  { title: "CI/CD pipelines", detail: "Build, test and release automation" },
  {
    title: "Cloud & infrastructure",
    detail: "Azure resources, IAM and Terraform",
  },
  {
    title: "Observability & reliability",
    detail: "Metrics, logs, alerts and incident response",
  },
  {
    title: "Capstone project",
    detail: "Ship and document an end-to-end delivery platform",
  },
];
export async function seed(db) {
  const now = new Date().toISOString();
  const statements = [
    db
      .prepare(
        "INSERT OR IGNORE INTO courses (id,title,description,syllabus,fee,currency) VALUES (?,?,?,?,?,?)",
      )
      .bind(
        "devops",
        "DevOps Engineering Bootcamp",
        "From your first commit to a confident production deployment. A practical, guided learning journey.",
        JSON.stringify(syllabus),
        0,
        "INR",
      ),
    db
      .prepare(
        "INSERT OR IGNORE INTO batches (id,course_id,name,start_date,end_date,timezone,covered,status) VALUES (?,?,?,?,?,?,?,?)",
      )
      .bind(
        "sandbox",
        "devops",
        "Starter batch · self-paced",
        "2026-11-15",
        "2026-12-15",
        "Asia/Kolkata",
        2,
        "active",
      ),
  ];
  const items = [
    [
      "notes-foundations",
      "notes",
      "DevOps foundations",
      "DevOps foundations",
      1,
      "DevOps brings development and operations together through shared ownership, automation and fast feedback.\n\nPractice: sketch how a code change reaches production. Identify where a build, test, approval and rollback belong.",
      "https://docs.google.com/document/d/13ZdkTrjkKLvg6ilyoyD_0h-DGL71lFk1/edit",
    ],
    [
      "slides-foundations",
      "slides",
      "From code to production",
      "DevOps foundations",
      1,
      "Your Day 01 presentation from the ARKS course library. Drive access permissions still apply.",
      "https://docs.google.com/presentation/d/1tWnHpN-mVZh1NIVIQF3_elU-MWR33KPD/edit",
    ],
    [
      "notes-git",
      "notes",
      "Git branches & merging",
      "Linux & Git",
      2,
      "Create isolated branches, review changes and merge with confidence. Open the class notes for diagrams and worked examples.",
      "https://docs.google.com/document/d/1I_v2TLAvHkupZGNkyY_KQraQ7xv36mt0/edit",
    ],
    [
      "lab-git",
      "lab",
      "Build your first Git workflow",
      "Linux & Git",
      2,
      "1. Initialize a repository and commit a README.\n2. Create a feature branch and add a script.\n3. Merge the branch into main.\n4. Introduce and resolve a merge conflict.\n\nSubmit your commands, a repository URL and an explanation of the conflict resolution. Never upload passwords, keys or tokens.",
      "",
    ],
    [
      "guide-azure",
      "guide",
      "Create a safe Azure lab environment",
      "Cloud & infrastructure",
      6,
      "1. Use a dedicated learning subscription or resource group.\n2. Set a budget alert before creating resources.\n3. Choose a region and apply owner/project tags.\n4. Create a small Linux VM; use SSH keys and restrict inbound access to your IP.\n5. Verify connectivity and document the deployment.\n6. Delete the resource group after the lab and verify costs.",
      "https://learn.microsoft.com/azure/virtual-machines/linux/quick-create-portal",
    ],
    [
      "sop",
      "sop",
      "Your bootcamp learning guide",
      "Course overview",
      1,
      "HOW WE LEARN\nAttend the live class or review its recording. Read the notes, attempt the lab, and take the daily knowledge check. Use Queries & concerns whenever you need support.\n\nASSESSMENTS\nDaily, weekly and monthly tests unlock when your instructor marks the required topics covered. Each test allows one attempt and totals 100 marks. Resume your attempt before the timer expires.\n\nCOMPLETION\nCompletion tracks published notes, recordings, presentations, guides and accepted labs. Live sessions, the SOP and tests are reported separately. A resource marked complete is self-reported; a lab is complete after admin acceptance.\n\nCLASSROOM EXPECTATIONS\nBe respectful, submit your own work, and never share secrets or personal data in labs.\n\nCOURSE SCOPE\nDevOps foundations, Linux, Git, Docker, Kubernetes, CI/CD, Azure, Terraform, observability and a capstone. The starter syllabus is editable by your administrator.",
      "",
    ],
  ];
  for (const [id, kind, title, topic, order, body, url] of items)
    statements.push(
      db
        .prepare(
          "INSERT OR IGNORE INTO content (id,course_id,kind,title,topic,topic_order,body,url,starts_at,duration,published,created) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
        )
        .bind(
          id,
          "devops",
          kind,
          title,
          topic,
          order,
          body,
          url,
          "",
          60,
          1,
          now,
        ),
    );
  const questions = [
    {
      prompt: "What is the main purpose of continuous integration?",
      options: [
        "Merge and validate changes frequently",
        "Deploy without tests",
        "Replace source control",
        "Store production secrets",
      ],
      answer: 0,
      explanation:
        "CI integrates changes frequently and validates them with automated builds and tests.",
    },
    {
      prompt: "Which command creates and switches to a new Git branch?",
      options: [
        "git status",
        "git switch -c feature",
        "git push --all",
        "git log",
      ],
      answer: 1,
      explanation: "git switch -c creates a new branch and switches to it.",
    },
    {
      prompt: "What should you do after finishing a cloud lab?",
      options: [
        "Leave everything running",
        "Publish credentials",
        "Delete unused resources and verify costs",
        "Disable billing alerts",
      ],
      answer: 2,
      explanation:
        "Remove unused resources and check costs to avoid unexpected charges.",
    },
  ];
  for (const [id, title, kind, order] of [
    ["daily-git", "Git essentials check-in", "daily", 2],
    ["weekly-foundations", "Foundations · weekly review", "weekly", 2],
    ["topic-devops", "DevOps foundations mastery", "monthly", 1],
  ])
    statements.push(
      db
        .prepare(
          "INSERT OR IGNORE INTO tests (id,course_id,title,kind,topic_order,duration,questions,published) VALUES (?,?,?,?,?,?,?,?)",
        )
        .bind(
          id,
          "devops",
          title,
          kind,
          order,
          10,
          JSON.stringify(questions),
          1,
        ),
    );
  await db.batch(statements);
}
