## **Agentic Institute – Systems design assessment**

### **Objective**

Design and implement a minimal chatbot system using the Pi Agent framework and Daytona that demonstrates an agent running inside an isolated compute environment. All should use typescript, and Convex for the backend runtime.

The primary goal is to showcase **architecture and system design**, not feature breadth. It doesn’t matter if you don’t understand how these technologies work.

---

### **Core Concept**

Each conversation (thread) should be backed by its own **dedicated Daytona session (VM)**.

* The **Pi Agent runs inside the Daytona VM**  
* The agent interacts with the VM through tools (e.g., filesystem, shell)  
* The system orchestrates conversations externally, but execution happens within the VM

This establishes a model where:

Each agent has its own isolated environment it can control and operate within.

---

### **Functional Requirements**

**1\. Chat Interface**

* Basic UI (no authentication required)  
* Ability to:  
  * Start a new conversation/thread  
  * Send and receive messages  
* Messages should stream progressively where possible (partial responses encouraged)

---

**2\. Conversation Lifecycle**

* Creating a new conversation:  
  * Spins up a **new Daytona session**  
  * Initializes a **Pi Agent inside that session**  
* Each conversation must maintain:  
  * Message history  
  * Tool execution history  
  * Associated VM/session state

---

**3\. Agent Execution Model**

* The Pi Agent must:  
  * Run *inside* the Daytona environment (not externally)  
  * Use tools to interact with the VM  
* The system should clearly separate:  
  * **Control plane** (UI \+ backend)  
  * **Execution plane** (agent inside VM)

---

### **4\. Tooling Support**

The agent must have access to the following tools:

* bash – execute shell commands  
* read – read file contents  
* write – create files  
* edit – modify files  
* grep – search file contents  
* glob – match file paths  
* webfetch – fetch web content  
* websearch – search the web

Tool execution should:

* Return structured outputs  
* Stream output where feasible (even if partial or chunked)

---

### **5\. Backend & Data Layer**

Use Convex for:

* Database  
* API/backend logic

The backend should handle:

* Conversation state  
* Message storage  
* Tool logs  
* Session ↔ VM mapping

---

### **6\. Observability**

Provide visibility into agent behavior, including:

* Message history (user \+ agent)  
* Tool usage history:  
  * Tool name  
  * Inputs  
  * Outputs  
  * Execution order  
* (Optional but encouraged)  
  * Streaming logs  
  * Execution timelines

---

### **Non-Goals**

* Authentication / user management  
* Advanced UI/UX polish  
* Large numbers of tools or complex capabilities  
* Production hardening

---

### **Evaluation Criteria**

Submissions will be evaluated primarily on:

**1\. Architecture Quality**

* Clear separation between control plane and execution plane  
* Correct placement of the Pi Agent inside Daytona  
* Clean handling of session lifecycle

**2\. System Design**

* How conversations map to VMs  
* State management (messages, tools, sessions)  
* Extensibility of the design

**3\. Observability**

* Ability to inspect and understand agent behavior  
* Clarity of logs and histories

**4\. Implementation Clarity**

* Code organization  
* Simplicity and correctness over complexity

---

### **Deliverables**

* Demo via [cap.so](https://cap.so/)  
* Source code via GitHub  
* README explaining:  
  * Architecture decisions  
  * How components interact  
  * Tradeoffs made  
  * Can be AI generated, just make sure information is consistent  
* All env variables

