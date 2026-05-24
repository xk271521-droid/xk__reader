# Third Party Notices

This project uses third party open source software. This notice is a practical
summary for users and maintainers; package manager lockfiles remain the source
of truth for the exact dependency graph.

## Project License

XK Reader is distributed under the GNU Affero General Public License v3.0 or
later. See [LICENSE](./LICENSE).

Source code is available at:

https://github.com/xk271521-droid/xk__reader

## Key Runtime Dependencies

| Component | Purpose | License Notes |
| --- | --- | --- |
| PyMuPDF / MuPDF | PDF reading, metadata, text extraction, page rendering, PDF annotation export | PyMuPDF is offered under AGPL-3.0 or a commercial license. |
| pdf.js / pdfjs-dist | Browser PDF rendering and text geometry | Apache-2.0. |
| React / React DOM | Frontend UI runtime | MIT. |
| Vite | Frontend build tooling | MIT. |
| FastAPI | Backend API framework | MIT. |
| Uvicorn | ASGI server | BSD-3-Clause. |
| SQLAlchemy | Database ORM | MIT. |
| Alembic | Database migrations | MIT. |
| PyMySQL | MySQL client | MIT. |
| python-docx | DOCX export and document processing | MIT. |
| OpenAI Python SDK | AI API client | Apache-2.0. |
| Alibaba Cloud SDK / oss2 | Cloud document and object storage integrations | See upstream package notices. |

## AGPL Network Source Offer

This application provides source code access through the visible source-code
link in the web interface. If you interact with a deployed version of this
application over a network, you can obtain the corresponding source code from:

https://github.com/xk271521-droid/xk__reader

## Maintainer Checklist

- Keep this repository public while the deployed service uses AGPL-covered
  components such as PyMuPDF under the open source license.
- Keep secrets, credentials, `.env` files, database dumps, uploaded documents,
  and private user data out of the public repository.
- Update this notice when adding or replacing major runtime dependencies.
- If a closed-source commercial distribution is required later, review PyMuPDF
  commercial licensing or migrate the PDF backend to compatible alternatives.
