# 📚 Notesbubble Automatic Study Resource Organizer

**Non-commercial use only** – This tool is designed to help students and educators automatically organize study resources. Commercial use is prohibited without permission.

---

## 🚀 Features
- Automatically sorts study resources into folders based on filename keywords.  
- Sends uncategorized files to an admin review folder.  
- Customizable folder structure and keyword rules.  
- Lightweight and easy to run locally.

---

## ⚙️ How It Works
1. Place all study resources in the **input folder**.  
2. The organizer scans filenames for keywords.  
3. Files are moved into **predefined folders** based on matches.  
4. Files that don’t match any keywords go to the **admin review folder**.

---

## 💻 Installation
```bash
git clone https://github.com/Reymarch995/NB-NotesOrganizer.git
pip install -r requirements.txt
python organizer.py
````

---

## 🛠 Configuration

Edit `config.json` to set:

* Input folder path
* Keyword-to-folder mappings
* Admin review folder path

Example:

```json
{
  "input_folder": "/user-uploads",
  "folders": {
    "Math": ["math", "emath", "mathematics"],
    "Physics": ["physics", "phy"]
  },
  "admin_folder": "/admin_review"
}
```

---

## 📝 Contribution

* Contributions are welcome for **educational and non-commercial purposes only**.
* Submit pull requests or open issues for bug fixes or features.
* Ensure contributions comply with the NC-SRO license.

---

## 📄 License

This project is licensed under the **Non-Commercial Study Resource Organizer License (NC-SRO)**.
See `LICENSE.md` for full terms.

---

## 📧 Contact

Rayhan, officialrayhan@notesbubble.com

```
```
