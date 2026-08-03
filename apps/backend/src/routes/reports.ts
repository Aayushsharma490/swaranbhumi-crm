import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../db';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { Readable } from 'stream';

export async function reportRoutes(fastify: FastifyInstance) {
  fastify.addHook('preValidation', async (request: any, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
    } catch (err) {
      reply.status(401).send({ error: 'Unauthorized' });
    }
  });

  // GET /reports/dashboard
  fastify.get('/dashboard', async (request: any) => {
    const currentUser = request.user as { id: string; role: string };
    
    // Set up user-scoped boundaries
    const isExecutive = currentUser.role === 'EXECUTIVE';
    const scopeFilter: any = {};
    if (isExecutive) {
      scopeFilter.assignedEmployeeId = currentUser.id;
    }

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    // Queries
    const [
      totalLeads,
      todayLeads,
      monthLeads,
      convertedLeads,
      lostLeads,
      followUpDue,
      revenueData,
      sourceBreakdown,
      projectBreakdown,
      recentActivities,
      notifications
    ] = await Promise.all([
      // Total
      prisma.lead.count({ where: scopeFilter }),
      // Today's Leads
      prisma.lead.count({
        where: {
          ...scopeFilter,
          createdAt: { gte: startOfToday }
        }
      }),
      // Monthly Leads
      prisma.lead.count({
        where: {
          ...scopeFilter,
          createdAt: { gte: startOfMonth }
        }
      }),
      // Converted
      prisma.lead.count({
        where: {
          ...scopeFilter,
          status: 'BOOKED'
        }
      }),
      // Lost
      prisma.lead.count({
        where: {
          ...scopeFilter,
          status: 'LOST'
        }
      }),
      // Follow Up Due (today or past, status not booked/lost/duplicate)
      prisma.lead.count({
        where: {
          ...scopeFilter,
          followUpDate: { lte: new Date() },
          status: { notIn: ['BOOKED', 'LOST', 'DUPLICATE'] }
        }
      }),
      // Revenue (PAID payments sum)
      prisma.payment.aggregate({
        where: isExecutive
          ? { booking: { lead: { assignedEmployeeId: currentUser.id } }, status: 'PAID' }
          : { status: 'PAID' },
        _sum: { amount: true }
      }),
      // Source Breakdown
      prisma.lead.groupBy({
        where: scopeFilter,
        by: ['leadSource'],
        _count: { _all: true }
      }),
      // Project Breakdown
      prisma.lead.groupBy({
        where: scopeFilter,
        by: ['project'],
        _count: { _all: true }
      }),
      // Recent Activities (Limit 15)
      prisma.leadTimeline.findMany({
        where: isExecutive
          ? { lead: { assignedEmployeeId: currentUser.id } }
          : {},
        take: 15,
        orderBy: { createdAt: 'desc' },
        include: {
          createdBy: { select: { name: true } },
          lead: { select: { name: true, phone: true } }
        }
      }),
      // Follow-up reminders for today (Notifications)
      prisma.lead.findMany({
        where: {
          ...scopeFilter,
          followUpDate: {
            gte: startOfToday,
            lte: new Date(startOfToday.getTime() + 24 * 60 * 60 * 1000)
          },
          status: { notIn: ['BOOKED', 'LOST', 'DUPLICATE'] }
        },
        select: {
          id: true,
          name: true,
          phone: true,
          project: true,
          followUpDate: true
        },
        take: 10
      })
    ]);

    // Format Source Breakdown
    const sources = sourceBreakdown.map((item: any) => ({
      source: item.leadSource || 'Direct',
      count: item._count._all
    }));

    // Format Project Breakdown
    const projects = projectBreakdown.map((item: any) => ({
      project: item.project || 'Unspecified',
      count: item._count._all
    }));

    return {
      metrics: {
        totalLeads,
        todayLeads,
        monthLeads,
        convertedLeads,
        lostLeads,
        followUpDue,
        revenue: revenueData._sum.amount || 0
      },
      sources,
      projects,
      recentActivities,
      notifications
    };
  });

  // GET /reports/export/excel
  fastify.get('/export/excel', async (request: any, reply: FastifyReply) => {
    const currentUser = request.user as { id: string; role: string };
    const scopeFilter: any = {};
    if (currentUser.role === 'EXECUTIVE') {
      scopeFilter.assignedEmployeeId = currentUser.id;
    }

    const leads = await prisma.lead.findMany({
      where: scopeFilter,
      orderBy: { createdAt: 'desc' },
      include: { assignedEmployee: { select: { name: true } } }
    });

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Leads Database');

    worksheet.columns = [
      { header: 'ID', key: 'id', width: 36 },
      { header: 'Name', key: 'name', width: 25 },
      { header: 'Phone', key: 'phone', width: 15 },
      { header: 'Alternate Phone', key: 'alternatePhone', width: 15 },
      { header: 'Email', key: 'email', width: 25 },
      { header: 'City', key: 'city', width: 15 },
      { header: 'State', key: 'state', width: 15 },
      { header: 'Budget', key: 'budget', width: 15 },
      { header: 'Project', key: 'project', width: 20 },
      { header: 'Property Type', key: 'propertyType', width: 15 },
      { header: 'Lead Source', key: 'leadSource', width: 15 },
      { header: 'Facebook Form', key: 'facebookFormName', width: 20 },
      { header: 'Priority', key: 'priority', width: 10 },
      { header: 'Status', key: 'status', width: 15 },
      { header: 'Assigned Agent', key: 'agent', width: 25 },
      { header: 'Follow-up Date', key: 'followUpDate', width: 20 },
      { header: 'Created Date', key: 'createdAt', width: 20 }
    ];

    leads.forEach((l: any) => {
      worksheet.addRow({
        id: l.id,
        name: l.name,
        phone: l.phone,
        alternatePhone: l.alternatePhone || '',
        email: l.email || '',
        city: l.city || '',
        state: l.state || '',
        budget: l.budget || '',
        project: l.project || '',
        propertyType: l.propertyType || '',
        leadSource: l.leadSource,
        facebookFormName: l.facebookFormName || '',
        priority: l.priority,
        status: l.status,
        agent: l.assignedEmployee?.name || 'Unassigned',
        followUpDate: l.followUpDate ? l.followUpDate.toISOString() : '',
        createdAt: l.createdAt.toISOString()
      });
    });

    // Formatting headers
    worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFF' } };
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: '2B6CB0' } // Indigo color theme
    };

    const buffer = await workbook.xlsx.writeBuffer();

    reply
      .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('Content-Disposition', 'attachment; filename="leads_report.xlsx"')
      .send(buffer);
  });

  // GET /reports/export/csv
  fastify.get('/export/csv', async (request: any, reply: FastifyReply) => {
    const currentUser = request.user as { id: string; role: string };
    const scopeFilter: any = {};
    if (currentUser.role === 'EXECUTIVE') {
      scopeFilter.assignedEmployeeId = currentUser.id;
    }

    const leads = await prisma.lead.findMany({
      where: scopeFilter,
      orderBy: { createdAt: 'desc' },
      include: { assignedEmployee: { select: { name: true } } }
    });

    let csvContent = 'ID,Name,Phone,Email,Project,Source,Status,Assigned Agent,Created Date\n';

    leads.forEach((l: any) => {
      const cleanName = l.name.replace(/"/g, '""');
      const cleanEmail = (l.email || '').replace(/"/g, '""');
      const cleanProject = (l.project || '').replace(/"/g, '""');
      const agent = l.assignedEmployee?.name || 'Unassigned';

      csvContent += `"${l.id}","${cleanName}","${l.phone}","${cleanEmail}","${cleanProject}","${l.leadSource}","${l.status}","${agent}","${l.createdAt.toISOString()}"\n`;
    });

    reply
      .header('Content-Type', 'text/csv')
      .header('Content-Disposition', 'attachment; filename="leads_report.csv"')
      .send(csvContent);
  });

  // GET /reports/export/pdf
  fastify.get('/export/pdf', async (request: any, reply: FastifyReply) => {
    const currentUser = request.user as { id: string; role: string };
    const scopeFilter: any = {};
    if (currentUser.role === 'EXECUTIVE') {
      scopeFilter.assignedEmployeeId = currentUser.id;
    }

    const leads = await prisma.lead.findMany({
      where: scopeFilter,
      orderBy: { createdAt: 'desc' },
      take: 50, // Cap at 50 for layout sizes in demo reports
      include: { assignedEmployee: { select: { name: true } } }
    });

    const doc = new PDFDocument({ margin: 30 });
    
    reply.header('Content-Type', 'application/pdf');
    reply.header('Content-Disposition', 'attachment; filename="leads_summary.pdf"');

    // Title / Header
    doc.fillColor('#2B6CB0').fontSize(24).text('Swaranbhumi CRM - Leads Summary', { align: 'center' });
    doc.moveDown(0.5);
    doc.fillColor('#4A5568').fontSize(10).text(`Generated on: ${new Date().toLocaleString()} | Scope: All Active Leads`, { align: 'center' });
    doc.moveDown(1.5);

    // Headers Table
    const tableTop = 120;
    doc.fontSize(10).fillColor('#1A202C');
    doc.font('Helvetica-Bold').text('Name', 30, tableTop);
    doc.font('Helvetica').text('Phone', 160, tableTop);
    doc.text('Project', 260, tableTop);
    doc.text('Source', 380, tableTop);
    doc.text('Status', 450, tableTop);

    // Border line below header
    doc.moveTo(30, tableTop + 15).lineTo(570, tableTop + 15).strokeColor('#CBD5E0').stroke();

    let y = tableTop + 25;
    leads.forEach((l: any) => {
      // Check pagination boundary
      if (y > 700) {
        doc.addPage();
        y = 50; // top of new page
      }

      doc.fillColor('#2D3748');
      doc.text(l.name.substring(0, 22), 30, y);
      doc.text(l.phone, 160, y);
      doc.text((l.project || 'Unspecified').substring(0, 18), 260, y);
      doc.text(l.leadSource, 380, y);
      doc.text(l.status, 450, y);

      y += 20;
    });

    doc.end();
    return doc;
  });
}
