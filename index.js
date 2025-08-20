const express = require("express");
const mysql = require("mysql2");
const cors = require("cors");
const bcrypt = require("bcrypt");
const session = require("express-session");

const bodyParser = require("body-parser");
const e = require("express");

function identifer() {
  let str = "qwertyuiopasdfghjklzxcvbnm";
  let h = "";
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      h += str[parseInt(Math.random() * 25)];
    }
    if (i != 2) {
      h += "-";
    }
  }
  return h;
}

const app = express();

app.use(cors({
  origin: "https://nephasoft.vercel.app",
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));

app.options("*", cors({
  origin: "https://nephasoft.vercel.app",
  credentials: true
}));

app.use(bodyParser.json());
app.use((req, res, next) => {
  console.log("SessionID:", req.sessionID);
  console.log(
    "User in session:",
    req.session ? req.session.user : "No session"
  );
  next();
});
app.use(
  session({
    secret: "secret-key", // use env in pro  duction
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      httpOnly: true,
      sameSite: "lax",
    },
  })
);

const sessions = {};

const SESSION_DURATION = 7 * 24 * 60 * 60 * 1000; // 7 days in ms

const mysql = require("mysql2");

const db = mysql.createConnection({
  host: "sql306.infinityfree.com",
  port: 3306,
  user: "if0_39743019",
  password: "9WZqZixVgrP",
  database: "if0_39743019_nephasoft",
  ssl: { rejectUnauthorized: true } // SkySQL requires SSL
});

db.connect((err) => {
  if (err) {
    console.error("Database connection failed:", err.stack);
    return;
  }
  console.log("Connected to MySQL");
});

app.post("/auth", async (req, res) => {
  const { name, email, password } = req.body;

  db.query(
    "SELECT * FROM users WHERE email = ?",
    [email],
    async (err, results) => {
      if (err) return res.status(500).send("DB error");

      if (results.length > 0) {
        const user = results[0];
        const match = await bcrypt.compare(password, user.password);
        if (!match)
          return res
            .status(401)
            .json({ failure: true, message: "Wrong password" });

        req.session.user = {
          id: user.id,
          name: user.name,
          email: user.email,
        };

        return res.status(200).json({
          message: "Login success",
          failure: false,
          user: req.session.user,
        });
      }

      const hashedPassword = await bcrypt.hash(password, 10);

      db.query(
        "INSERT INTO users (name, email, password) VALUES (?, ?, ?)",
        [name, email, hashedPassword],
        (err, result) => {
          if (err)
            return res
              .status(500)
              .json({ failure: true, message: "Insert error" });

          // Set session
          req.session.user = {
            id: result.insertId,
            name,
            email,
          };

          return res.status(200).json({
            message: "Registered & Logged in",
            failure: false,
            user: req.session.user,
          });
        }
      );
    }
  );
});

app.post("/form/new", (req, res) => {
  const { title, desc, questions } = req.body;
  const identifier = identifer();
  const userId = req.session.user?.id;
  console.log("userId", userId);
  console.log("user", req.session);

  if (!userId) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  const query = `INSERT INTO forms (title, description, creator, identifier)
VALUES (?, ?, ?,?);`;

  const sub_query = `INSERT INTO questions (form_id, question, type,is_required,position)
VALUES (?, ?, ?,?,?);`;

  const options_sub_query = `INSERT INTO question_options (question_id, option_text, position)
VALUES (?, ?, ?);`;
  db.query(query, [title, desc, userId, identifier], (err, result) => {
    if (err) {
      console.error("Error saving form:", err);
      return res.status(500).send("Error saving form");
    }
    let position = 0;
    for (let q of questions) {
      position++;
      db.query(
        sub_query,
        [result.insertId, q["question"], q["type"], q["mode"] == 1, position],
        (serr, sresult) => {
          if (serr) {
            console.error("Error saving form:", serr);
            return res.status(500).send("Error saving form");
          }
          if (q["type"] == "options") {
            let j = 0;
            for (let o of q["options"]) {
              j++;
              db.query(
                options_sub_query,
                [sresult.insertId, o, j],
                (oerr, oresult) => {
                  if (oerr) {
                    console.error("Error saving form:", oerr);
                  }
                }
              );
            }
          }
        }
      );
    }

    res.status(201).send({ id: result.insertId, identifier });
  });
});

// Fetch Forms
app.get("/api/forms", (req, res) => {
  db.query("SELECT * FROM forms", (err, results) => {
    if (err) {
      console.error("Error fetching forms:", err);
      return res.status(500).send("Error fetching forms");
    }
    res.json(results);
  });
});

app.get("/form/saved/:x", (req, res) => {
  const x = req.params.x;
  if (!req.session.user) {
    return res.status(401).json({ failure: true, nologin: true });
  }
  db.query(
    `SELECT 
      f.id AS form_id,
      f.title AS form_title,
      f.description AS form_description,
      q.id AS question_id,
      q.question,
      q.type,
      q.is_required,
      qo.option_text
    FROM forms f
    JOIN questions q ON q.form_id = f.id
    LEFT JOIN question_options qo ON qo.question_id = q.id
    WHERE f.identifier = ?
    ORDER BY q.position, qo.position;`,
    [x],
    (err, results) => {
      console.log(x);

      if (err) {
        console.error("Error fetching forms:", err);
        return res.status(500).send("Error fetching forms");
      }
      if (!results.length) return res.status(404).send("Form not found");

      const structured = {
        title: results[0].form_title,
        desc: results[0].form_description,
        questions: [],
      };

      const questionMap = new Map();

      results.forEach((row) => {
        if (!questionMap.has(row.question_id)) {
          const question = {
            question: row.question,
            type: row.type,
            id: row.question_id,
            is_required: row.is_required,
          };

          if (row.is_required) {
            question.mode = row.is_required;
          }

          if (row.type === "options") {
            question.options = [];
          }

          questionMap.set(row.question_id, question);
          structured.questions.push(question);
        }

        if (row.type === "options" && row.option_text) {
          questionMap.get(row.question_id).options.push(row.option_text);
        }
      });

      res.json(structured);
    }
  );
});
app.post("/", (req, res) => {
  if (req.session && req.session.user) {
    db.query(
      `SELECT 
  f.id AS form_id,
  f.title AS form_title,
  f.description AS form_description,
  f.created_at,
  f.identifier,
  COUNT(r.id) AS submission_count
FROM forms f
LEFT JOIN responses r ON f.identifier = r.form_identifier
WHERE f.creator = ?
GROUP BY f.id;`,
      [req.session.user["id"]],
      (err, results) => {
        if (err) {
          console.error("Error fetching forms:", err);
          return res.status(500).send("Error fetching forms");
        }

        res.json({
          failure: false,
          results: results,
          user: req.session.user.name,
        });
      }
    );
  } else {
    res.json({ failure: true });
  }
});
app.post("/logout", (req, res) => {
  req.session.destroy(() => res.sendStatus(200));
});
app.post("/submission", (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ failure: true, message: "Login first" });
  }
  const { attemp, refer } = req.body;
  const identifer = refer.split("/")[refer.split("/").length - 1];
  const query = `INSERT INTO responses (form_identifier, user_id, response_data)
VALUES (?, ?, ?);`;
  db.query(
    query,
    [identifer, req.session.user["id"], JSON.stringify(attemp)],
    (err, result) => {
      if (err) {
        console.error("Error saving form:", err);
        return res.status(500).json({ failure: true });
      }
      res.status(200).json({});
    }
  );
});

app.post("/responses/:identifier", (req, res) => {
  if (!req.session.user) {
    return res
      .status(401)
      .json({ failure: true, message: "Login in order to continue" });
  }
  const identifer = req.params.identifier;
  db.query(
    "select response_data,submitted_at from responses where form_identifier = ?",
    [identifer, req.session.user.id],
    (err, result) => {
      if (err) {
        console.log(err);
        return res.status(500).json({ failure: true });
      }
      db.query(
        `SELECT questions.id,questions.question
FROM questions
WHERE questions.form_id = (
  SELECT id
  FROM forms
  WHERE identifier = ?
);
`,
        [identifer],
        (err2, result2) => {
          if (err2) {
            console.log(err2);
            return res.status(500).json({ failure: true });
          }

          db.query(
            `SELECT * FROM forms WHERE identifier = ?;`,
            [identifer],
            (err3, result3) => {
              if (err3) {
                console.log(err3);
                return res.status(500).json({ failure: true });
              }
              if (result3[0]["creator"] != req.session.user.id) {
                return res.status(401).json({ failure: true, admin: 0 });
              }

              res.status(200).json({
                failure: false,
                responses: result,
                questions: result2,
                meta: result3[0],
              });
            }
          );
        }
      );
    }
  );
});
app.get("/logged", (req, res) => {
  if (!req.session.user) {
    return res.status(401).send({ failure: true });
  }
  return res.status(200).send({ failure: false, user: req.session.user.name });
});

app.post("/updatepassword", async (req, res) => {
  const { email, password, New } = req.body;

  if (!req.session.user) {
    return res
      .status(401)
      .json({ failure: true, message: "Login in order to continue" });
  }
  db.query(
    "select password FROM users WHERE id = ? and email = ?",
    [req.session.user.id, email],
    async (err, results) => {
      if (err) return res.status(500).send("DB error");

      if (results.length > 0) {
        const pass = results[0].password;
        console.log(password);

        const match = await bcrypt.compare(password, pass);
        if (!match)
          return res
            .status(401)
            .json({ failure: true, message: "Wrong password" });
        console.log("new@: ", New);

        let newp = await bcrypt.hash(New, 10);

        db.query(
          "update users set password = ? where id = ?",
          [newp, req.session.user.id],
          (err, result) => {
            if (err)
              return res
                .status(500)
                .json({ failure: true, message: "Insert error" });

            return res.status(200).json({
              message: "Successfully updated password",
              failure: false,
            });
          }
        );
      }
    }
  );
});

app.post("/delete", async (req, res) => {
  const { identifier } = req.body;

  if (!req.session.user) {
    return res
      .status(401)
      .json({ failure: true, message: "Login in order to continue" });
  }
  db.query(
    "delete FROM forms WHERE creator = ? and identifier = ?",
    [req.session.user.id, identifier],
    async (err, results) => {
      console.log(err);
      console.log(results);

      if (err) return res.status(500).send("DB error");
      return res.status(200).json({ failure: false });
    }
  );
});

const PORT = 5000;
app.listen(PORT, () => console.log(`Server running at port ${PORT}`));
