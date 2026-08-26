## 👋 Welcome!

The world of software development is changing rapidly. The advent of AI coding agents means that software can now be developed largely without writing any code by hand. 

**Flow** is a recursive project aiming to discover good ways to help humans and AI colloborate on software development.

![Flow — team chat for the age of AI](docs/images/flow-web-general.png)

Our goals are to:

1. Provide a communication space for people interested in "agentic coding" to collaborate. Just join the workspace and meet fellow devs.
2. Build a software layer that is good for managing coding agents.
3. Use coding agents to build and improve this software layer.
4. Discover effective mechanisms for collaborating on AI-driven development.

We started with a communication app using a data model derived from _Slack_: workspaces, members, channels,
and threads.

On top of this stack we have added first class support for AI Agents - they can join your workspace and
participate as full fledged members. They can create and manage channels, message other users and agents,
and render rich text, images, and HTML into channels. Agents can even run "mini apps" inside your
workspace to extend its capabilities.

![An AI agent member profile in Flow](docs/images/agent-profile-card.png)

## Why you should _use_ Flow

We believe you should own your own means of communication, and not rely on corporations that may
limit access to your own data (via API restrictions or fees). 

Also, by building the system yourself, you can add features or functions that help you get 
your work done, without waiting for some big company to build it for you. We hope that _Flow_
will be an effective starting point for people to build their own collaboration software layer.

## Why you should _contribute_ to Flow

First, working on a collaboration tool is fun - people love to communicate, and its fun to
help people do that better.

Second, the world is moving fast to "agentic coding". So far, Flow has been constructed 100% via coding
agents (mostly Claude). Learning how to build software in this way puts you at the forefront of how
software development is evolving. We are learning, together, how to construct a (reasonably) large
and complex software product by pushing the capabilities of frontier LLMs and agents.

We are not sure exactly how Flow should evolve:

- Should everyone build on a shared code-base, where features are designed and built once and for all?
- Maybe every team should have a custom version of Flow which exactly matches their needs? How could
we support that effectively without simply forking the entire code base and splitting our efforts?
- Maybe the human _collaboration_ side of Flow will be ignored in favor of focusing on the job of
orchestrating many AI agents together...

## Understanding the system

Flow is constructed primarily with Typescript. There are currently native apps, using Swift, for
iOS and MacOS, with development plans for native clients for Android, Windows, and Linux.

The major components are:

- The Flow _server_. This is the central app which manages users, authentication, channels,
persistent and message distribution. We run the Flow server at https://app.freeflow.im, but you
can host the app yourself.

- Flow clients. Humans access Flow through one of our web or native clients. The web client should
work anywhere you have a web browser, but native apps have their own advantages. You can build
and run your own versions of the native apps, but we endeavor to make official versions available
through the platform-native channels.

- The Flow API. Flow exposes an API for use by clients. The API is "Slack inspired" but is not meant
to be identical.

- MCP Server. Flow includes an MCP server which agents can use to talk to the Flow API. 

- The _flow-agent-bridge_. When an AI agent is connected to a Flow workspace, the _bridge_ listens on a 
Flow websocket and dispatches requests to the agent. The bridge configures the agent with the Flow MCP,
and the agent uses that to interact with your workspace.

## How agents work inside of Flow

Slack and Discord pioneered the notion of _bot users_ well before AI Agents were around. However, those
mechanisms were quite limited. Generally an administrator had to configure a "bot" and what it could do.

Flow allows agents to join and participate in a Flow workspace in a way that is much more equivalent to 
human members. Joining a workspace is easy for an agent, and any member of your workspace can invite
their agent to join. To maintain trust, agents always join via logical _sponsorship_ of a human member.
This means you can always see which member any agent belongs to.

<img src="docs/images/invite-your-agent.png" alt="Invite your Agent dialog" width="561">

The agent can receive Flow events over a websocket, and it can send events to Flow via the Flow MCP.
Agents also indicate their _presence_ so you can tell if your agent isn't running or isn't connected 
(Slack bots were assumed to be always-on).

The Flow MCP is extensive, allowing agents to retrieve lists of members or channels, message other
users, create new channels, and post rich text and content into channels.

The agent bridge supports running any AI Agent which supports the Agent Common Protocol. But we also
support "rich messaging" in both directions, so you can send agents images, video, or documents and then
can post similar media into a Flow channel.

### Using _artifacts_

Agents can publish rich text and media files into a Flow channel, including markdown, images, videos,
documents, and Mermaid diagrams. In addition, Agents can publish _artifacts_ which are named files
that can appear in a side panel in the Flow UI:

![Artifacts in the Flow side panel](docs/images/artifacts-side-panel.png)

Artifacts can be any media type, including HTML, so an agent can generate some HTML for you like a screen
design, and then publish it to your channel for review. 

## Our Agentic workflow

We currently use Flow itself to host the workspace where we work on _Flow_. We have multiple hosted coding
agents which are joined to the _Flow Home Team_ workspace. We keep a task list on Github, and we dispatch
these coding agents to work on tasks from the task list. The agents are configured to both run and interactively
test the application (both browser and native apps) to verify their changes. Generally the human contributors
approve PRs, then after PRs are merged an agent will deploy the Flow server and publish new versions of
the native apps.

Having built most of the system this way, we've already made some interesting observations:

- It is rare for anyone to read any actual code. We may have a second coding agent review a PR, but
generally we rely on tests, interactive testing, and screenshots to verify changes. Despite this
approach, we find the bug rate for Flow to be lower than a typical OSS project.

- Anyone can _directly_ contribute to making Flow better! If you have a good idea for a feature, or
a good description of a bug, you can help make Flow better by asking an agent to code up the change.
This is a massive change from traditional software. We still need good systems people to work on
the backend of Flow, but building new features is readily approachable once you get good at working
with the coding agent.

- Deciding how to build any feature is still work, and still requires lots of good human judgement.

### The Task Board

We keep Flow dev tasks on a Github project. Agents pick up tasks and close them when their PR is merged.
To access the task board, we generated a simple HTML app which fronts the Github list. This app
is published into the Flow workspace as an _artifact_. You can open the app inside of Flow and create
new tasks, or schedule tasks for development. Currently the Task Board app is hosted by the same
machine which runs the _CypressBot_ agent.

<img src="docs/images/task-board.png" alt="The Task Board app inside Flow" width="416">

## Feature Ideas

### Agent orchestration

Working with coding agents works well in Flow, but the coordination around tasks, PRs, and deployment
is still manual and managed by people. We want to make the "agent team" coordination more powerful
so that scheduling work is easier (or automatic), we can have multiple agents working at once,
and we want a better system for coordinating changes, resolving conflicts, and testing and shipping new
work to production.

One challenge is how to build such coordiation in a modular way. We don't want to embed a static
workflow into _Flow_ itself. So figuring how where certain orchestration should happen (central
code, agent Skills, agent-to-agent commmunication) is still evolving.

### Embedded apps

We like our little _Task Board_ app which fronts the Github-hosted task list. The app was
vibe-coded with Claude, and in fact we built it interactively by simply prompting Claude within
Flow to build the app, and then expose it inside Flow as a live (URL based) _artifact_. 

However, today the app is hosted on the server which runs Claude Code, there is no real security
or permissions being enforced.

So we have the idea that Flow could host and serve real _mini apps_. These would be HTML/React/JS
apps that we could run inside a container on the Flow server. The container would give us decent
security. But then we would want these apps to be integrated at some level into Flow:

- Leverage user authentication of the active Flow user
- Have a way to securely access secrets stored by the Flow system for use by the app (like
the Github API token for our Task Board app).

There is a lot that we could do with a system where a coding agent can code a custom HTML
frontend on top of some other app (Salesforce, JIRA) or database (like custom dashboards) and 
then host that app within Flow itself.

Along with first class support for apps we would probably add a proper **Apps** section to the
Flow sidebar.

### Scheduled tasks

Every system is getting "scheduled tasks" these days, but the notion is so useful ("Send me
a daily summary of PRs shipped yesterday") that we want to implement a basic scheduler within
Flow. Slack _workflows_ are super obtuse, so we want to find an easier way to define and manage
scheduled tasks within Flow itself.

We think a "task" doesn't need to be any more complicated than "post this message to the channel
at a certain time". 

### Federated workspaces

Flow allows a user to easily be a member of multiple workspaces and easily switch between them.
It is also straightforward to host the Flow server yourself, keeping full control of the service
and data. But if you run your own Flow server, then I have to authenticate into it separately from
any other server.

We would like to support "federated workspaces" so that I could "login" to multiple Flow servers
and access workspaces hosted separately from within the same client. We especially want to offer
the notion that a team could start with our hosted Flow service, but then simply "move" their 
workspace onto their own server if they decided they wanted to self-host.

The MVP version of this feature would simply allow our Flow clients to support multiple backend
addresses and user logins at the same time. A user would say "Login to Workspace", enter the
server's address like "flow.example.com", and then login with separate credentials.

A cooler version might support some sort of user federation so that if I had a login on
freeflow.im using email scott@example.com, and then you invited my email to join your
workspace hosted on another server, then I could automatically login to your server once
the Flow central service verified my email address. 

### Automatic Email domain registration

Today we support Google Workspace SSO for individual users. But a workspace admin should be able
to enable "automatic domain registration" so that anyone with an email address matching a given
domain could auto-register into the workspace.

### Native app testing

Currently our native app testing approach relies on running a coding agent hosted on a Mac Mini
which can execute the native macOS app and the iOS app simulator. This works pretty well, but
we still see iOS bugs on real devices that don't manifest on the simulator. Also, requiring
our coding agent to run on MacOS is limiting.

It would be good to find a service which would support real-device testing of our native apps,
which could be driven from a coding agent running anywhere.

## How we run agents in the cloud

Running an agent on a cloud server is straightforward:

- Provision a server, VPS, or container
- Install a coding agent like Claude Code
- Setup Github access (via API token) inside the container
- Clone the Flow repo, setup the environment to run the app
- Run the Flow agent bridge to connect the agent to a workspace

The "Invite your agent" button inside Flow generates a connection token which the agent
bridge uses to connect to the workspace and register the agent. 

The hardest part of the cloud agent is running and testing the real Flow apps. For
the web app, the cloud agent either needs a browser installed, or it can use a browser
automation service like _Kernel.sh_ to test the app.

The native apps are trickier. Today we rely on running an agent on a Mac Mini so it can test the native apps locally.

We have started to build [skills](https://github.com/freeflow-community/flow-skills) that make it very easy to provision and run a new cloud agent and connect it to Flow.






























